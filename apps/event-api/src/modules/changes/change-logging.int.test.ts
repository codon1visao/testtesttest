import {
  GenerationIdSchema,
  SubmitFeedbackResponseSchema,
  SUPPLIED_EVENT,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import type { Redis } from "ioredis";
import request from "supertest";
import type { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { composeEventApi, type EventApi } from "../../compose.js";
import { uuidV7IdGenerator } from "../../integrations/uuid-v7-id-generator.js";
import { createLogger } from "../../shared/logger.js";
import { openTestDataSource, truncateAllTables } from "../../testing/database.js";
import { clearApplicationKeys, openTestRedis } from "../../testing/redis.js";
import {
  DEFAULT_ITEMS,
  insertGenerationFixture,
  putPreviewSlot,
} from "../../testing/sql-fixtures.js";
import { integrationConfig } from "../../testing/test-config.js";

/** Each change the backend handles leaves one metadata-only log line, after its commit. */

const E101 = SUPPLIED_EVENT.id;
const ORIGIN = "http://localhost:5173";
const NOTE_TEXT = "The second hill was far too steep for the slower group.";
const EDITS = {
  attendanceOverview: "4 registered members: 1 attended, 2 absent, 1 not recorded.",
  feedbackSummary: "Feedback describes the walk as enjoyable.",
  themes: ["People asked for longer rest breaks."],
  conflicts: ["Start time: earlier suits some, not others."],
  suggestions: ["Review the route length."],
};
let dataSource: DataSource;
let redis: Redis;
let api: EventApi;
let lines: string[];

type LogLine = Record<string, unknown> & { msg: string };
const logged = (): LogLine[] => lines.map((line) => JSON.parse(line) as LogLine);
const messages = () => logged().map((line) => line.msg);
const line = (msg: string) => logged().find((entry) => entry.msg === msg);

const generationId = GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-000000000001");
async function insertGeneration() {
  await insertGenerationFixture(dataSource, {
    id: generationId,
    runId: "manual:run-1",
    items: DEFAULT_ITEMS.map((item, index) => ({
      ...item,
      id: `0199a4e8-0000-7000-8001-${String(index).padStart(12, "0")}`,
    })),
  });
}
const send = (method: "post" | "put", path: string, body: object) =>
  request(api.app)[method](`/api/events/${E101}${path}`).set("Origin", ORIGIN).send(body);

beforeAll(async () => {
  dataSource = await openTestDataSource();
  redis = await openTestRedis();
});
afterAll(async () => {
  await clearApplicationKeys(redis);
  redis.disconnect();
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await clearApplicationKeys(redis);
  lines = [];
  const logger = createLogger("info", { write: (chunk: string) => void lines.push(chunk) });
  api = await composeEventApi(integrationConfig({ batchWindowMs: 60_000 }), { logger });
  lines.length = 0; // startup lines are not under test
});
afterEach(async () => {
  await api.close();
});

describe("change logging", () => {
  it("logs accepted feedback by ID only, before its change is published", async () => {
    const res = await send("post", "/feedback", {
      submissionId: uuidV7IdGenerator.itemId(),
      text: NOTE_TEXT,
    });
    expect(res.status).toBe(201);
    const noteId = SubmitFeedbackResponseSchema.parse(res.body).note.id;
    expect(line("feedback accepted")).toMatchObject({ level: 30, eventId: E101, noteId });
    const order = messages();
    expect(order.indexOf("feedback accepted")).toBeLessThan(order.indexOf("change published"));
    expect(lines.join("")).not.toContain(NOTE_TEXT);
  });

  it("logs a repeated submission as replayed, not accepted", async () => {
    const body = { submissionId: uuidV7IdGenerator.itemId(), text: NOTE_TEXT };
    const noteId = SubmitFeedbackResponseSchema.parse((await send("post", "/feedback", body)).body)
      .note.id;
    lines.length = 0;
    expect((await send("post", "/feedback", body)).status).toBe(200);
    expect(line("feedback replayed")).toMatchObject({ eventId: E101, noteId });
    expect(messages()).not.toContain("feedback accepted");
    expect(lines.join("")).not.toContain(NOTE_TEXT);
  });

  it("logs saved attendance with the number of changed members and the new revision", async () => {
    const members = SUPPLIED_MEMBERS.map((m) => ({
      id: m.id,
      attendance: m.attendance === "not_recorded" ? "attended" : m.attendance,
    }));
    expect((await send("put", "/attendance", { baseAttendanceRevision: 0, members })).status).toBe(
      200,
    );
    expect(line("attendance saved")).toMatchObject({
      eventId: E101,
      changedMembers: SUPPLIED_MEMBERS.filter((m) => m.attendance === "not_recorded").length,
      attendanceRevision: 1,
    });
  });

  it("logs nothing for a rejected change", async () => {
    const members = SUPPLIED_MEMBERS.map((m) => ({ id: m.id, attendance: m.attendance }));
    expect((await send("put", "/attendance", { baseAttendanceRevision: 7, members })).status).toBe(
      409,
    );
    expect(messages()).not.toContain("attendance saved");
    expect(messages()).not.toContain("change published");
  });

  it("logs a selected preview and a saved briefing", async () => {
    await insertGeneration();
    await putPreviewSlot(dataSource, "incoming", generationId);
    const selected = await send("post", "/briefing-preview/select", {
      generationId,
      expectedSelectedGenerationId: null,
    });
    expect(selected.status).toBe(200);
    expect(line("preview selected")).toMatchObject({ eventId: E101, generationId });

    const saved = await send("put", "/briefing", {
      baseBriefingRevision: 0,
      generationId,
      textEdits: EDITS,
    });
    expect(saved.status).toBe(200);
    expect(line("briefing saved")).toMatchObject({
      eventId: E101,
      generationId,
      briefingRevision: 1,
    });
    expect(lines.join("")).not.toContain(EDITS.feedbackSummary);
  });
});
