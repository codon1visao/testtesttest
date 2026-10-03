import {
  EventViewSchema,
  GenerateBriefingResponseSchema,
  SUPPLIED_EVENT,
  type EventView,
} from "@event-desk/contracts";
import type { Redis } from "ioredis";
import request from "supertest";
import type { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { composeEventApi, type EventApi } from "../../compose.js";
import { usageKey } from "../../integrations/redis-keys.js";
import { uuidV7IdGenerator } from "../../integrations/uuid-v7-id-generator.js";
import { openTestDataSource, truncateAllTables } from "../../testing/database.js";
import {
  DEFAULT_ITEMS,
  GENERATION_FIXTURE_ID,
  insertGenerationFixture,
  insertSavedBriefing,
  putPreviewSlot,
} from "../../testing/sql-fixtures.js";
import { type FakeGateway, startFakeGateway } from "../../testing/fake-gateway.js";
import { clearApplicationKeys, openTestRedis } from "../../testing/redis.js";
import { integrationConfig, silentLogger } from "../../testing/test-config.js";

const E101 = SUPPLIED_EVENT.id;
const ORIGIN = "http://localhost:5173";
const SECRET = integrationConfig().gateway.secret;
const WINDOW_MS = 300;
let dataSource: DataSource;
let redis: Redis;
let gateway: FakeGateway;
let api: EventApi;

/** The note IDs a Gateway request carried; only the shape this test reads. */
const RequestInputSchema = z.object({ feedback: z.array(z.object({ id: z.string() })) });

const submit = (text: string) =>
  request(api.app)
    .post(`/api/events/${E101}/feedback`)
    .set("Origin", ORIGIN)
    .send({ submissionId: uuidV7IdGenerator.itemId(), text });
const generate = () =>
  request(api.app)
    .post(`/api/events/${E101}/briefing-generations`)
    .set("Origin", ORIGIN)
    .send({ baseAttendanceRevision: 0 });
const view = async (): Promise<EventView> =>
  EventViewSchema.parse((await request(api.app).get(`/api/events/${E101}`)).body);
const outcomes = async () =>
  (
    await dataSource.query<{ trigger_type: string; status: string; error_code: string | null }[]>(
      "SELECT trigger_type, status, error_code FROM generation_outcomes ORDER BY finished_at, run_id",
    )
  ).map(
    (row) =>
      `${row.trigger_type}:${row.status}${row.error_code === null ? "" : `:${row.error_code}`}`,
  );
const requestNotes = (index: number): string[] =>
  RequestInputSchema.parse(gateway.requests[index]?.input).feedback.map((note) => note.id);

beforeAll(async () => {
  dataSource = await openTestDataSource();
  redis = await openTestRedis();
});
afterAll(async () => {
  await clearApplicationKeys(redis);
  redis.disconnect();
  await dataSource.destroy();
});
const startApi = async (batchWindowMs: number) => {
  api = await composeEventApi(
    integrationConfig({
      batchWindowMs,
      gateway: { host: "127.0.0.1", port: gateway.port, secret: SECRET },
    }),
    { logger: silentLogger },
  );
};

beforeEach(async () => {
  await truncateAllTables(dataSource);
  await clearApplicationKeys(redis);
  gateway = await startFakeGateway(SECRET);
  await startApi(WINDOW_MS);
});
afterEach(async () => {
  gateway.release();
  await api.close();
  await gateway.close();
});

describe("automatic batches end to end (F7, T5)", () => {
  it("F7-01: five quick notes make one background call that reads all thirteen notes", async () => {
    // A longer window: five sequential requests must fit in it however slow the machine is.
    await api.close();
    await startApi(2_000);
    for (const text of ["One.", "Two.", "Three.", "Four.", "Five."])
      expect((await submit(text)).status).toBe(201);
    const collecting = await view();
    expect(collecting.generation.batch).toMatchObject({
      state: "collecting",
      newNoteIds: ["F09", "F10", "F11", "F12", "F13"],
    });
    await vi.waitFor(
      async () => {
        expect(await outcomes()).toEqual(["feedback_batch:succeeded"]);
      },
      { timeout: 8_000 },
    );
    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]).toMatchObject({ lane: "background" });
    expect(requestNotes(0)).toHaveLength(13);
    const after = await view();
    expect(after.incomingPreview?.trigger).toBe("feedback_batch");
    expect(after.generation.batch).toBeNull();
    expect(after.generation.lastOutcome).toMatchObject({
      trigger: "feedback_batch",
      status: "succeeded",
    });
  });

  it("F7-04 / F7-05: while the worker is busy, the newest ready job reads every note and older ones are superseded", async () => {
    gateway.enqueue({ kind: "hold" });
    await submit("First window.");
    await vi.waitFor(
      () => {
        expect(gateway.requests).toHaveLength(1);
      },
      { timeout: 5_000 },
    );
    expect((await view()).generation.batch).toMatchObject({ state: "generating" });
    await submit("Second window.");
    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS + 150));
    await submit("Third window.");
    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS + 150));
    gateway.release();
    await vi.waitFor(
      async () => {
        expect(await outcomes()).toEqual([
          "feedback_batch:succeeded",
          "feedback_batch:superseded",
          "feedback_batch:succeeded",
        ]);
      },
      { timeout: 8_000 },
    );
    expect(gateway.requests).toHaveLength(2);
    // The newest job read every saved note: the 8 supplied ones and F09–F11.
    expect(requestNotes(1)).toHaveLength(11);
    expect(requestNotes(1)).toEqual(expect.arrayContaining(["F09", "F10", "F11"]));
  });

  it("F7-06: Generate during a batch call runs at once on the interactive lane and is never replaced by it", async () => {
    gateway.enqueue({ kind: "hold" }); // the batch call
    await submit("Batch note.");
    await vi.waitFor(
      () => {
        expect(gateway.requests).toHaveLength(1);
      },
      { timeout: 5_000 },
    );
    const manual = await generate();
    expect(manual.status).toBe(201);
    expect(gateway.requests[1]).toMatchObject({ lane: "interactive" });
    const manualId = GenerateBriefingResponseSchema.parse(manual.body).incomingPreview.provenance
      .generationId;
    gateway.release();
    await vi.waitFor(
      async () => {
        expect(await outcomes()).toContain("feedback_batch:superseded");
      },
      { timeout: 5_000 },
    );
    expect((await view()).incomingPreview?.provenance.generationId).toBe(manualId);
  });

  it("F7-07: a window closing during a manual generation waits, then skips as nothing new", async () => {
    gateway.enqueue({ kind: "hold" }); // the manual call
    await submit("A note before Generate.");
    // A supertest request is sent only once it is awaited or then'd: start it now.
    const manual = generate().then((response) => response.status);
    await vi.waitFor(
      async () => {
        expect((await view()).generation.batch).toMatchObject({ state: "waiting" });
      },
      { timeout: 5_000 },
    );
    gateway.release();
    expect(await manual).toBe(201);
    await vi.waitFor(
      async () => {
        expect(await outcomes()).toEqual(["manual:succeeded", "feedback_batch:skipped"]);
      },
      { timeout: 5_000 },
    );
    expect(gateway.requests).toHaveLength(1);
  });

  it("F7-08: an unreviewed manual preview stays; it lists the notes that arrived since", async () => {
    expect((await generate()).status).toBe(201);
    await submit("Later note.");
    await vi.waitFor(
      async () => {
        expect(await outcomes()).toEqual([
          "manual:succeeded",
          "feedback_batch:superseded_by_manual",
        ]);
      },
      { timeout: 5_000 },
    );
    const after = await view();
    expect(after.incomingPreview?.trigger).toBe("manual");
    expect(after.incomingPreview?.freshness.newFeedbackIds).toEqual(["F09"]);
  });

  it("F7-12: a temporary provider error retries with backoff and then succeeds", async () => {
    await insertGenerationFixture(dataSource);
    await insertSavedBriefing(dataSource, {
      generationId: GENERATION_FIXTURE_ID,
      attendanceOverview: "Saved overview.",
      itemTexts: Object.fromEntries(DEFAULT_ITEMS.map((item) => [item.id, "Saved text."])),
    });
    await putPreviewSlot(dataSource, "selected", GENERATION_FIXTURE_ID);
    const before = await view();
    expect(before.savedBriefing).not.toBeNull();
    expect(before.selectedPreview).not.toBeNull();
    gateway.enqueue({ kind: "error", code: "PROVIDER_TEMPORARY", notSent: false });
    await submit("Retry me.");
    await vi.waitFor(
      async () => {
        expect((await view()).generation.batch).toMatchObject({
          state: "retry_wait",
          attempt: 2,
          maxAttempts: 3,
        });
      },
      { timeout: 5_000 },
    );
    await vi.waitFor(
      async () => {
        expect(await outcomes()).toEqual(["feedback_batch:succeeded"]);
      },
      { timeout: 8_000 },
    );
    expect(gateway.requests.map((r) => r.attemptId)).toEqual(["1", "2"]);
    // The automatic result went to the incoming slot only: the saved and selected slots are as they were.
    const after = await view();
    expect(after.incomingPreview?.trigger).toBe("feedback_batch");
    // (Their freshness moves on: F09 is new to both.)
    expect(after.savedBriefing?.provenance).toEqual(before.savedBriefing?.provenance);
    expect(after.savedBriefing?.content).toEqual(before.savedBriefing?.content);
    expect(after.savedBriefing?.savedAt).toEqual(before.savedBriefing?.savedAt);
    expect(after.selectedPreview?.provenance).toEqual(before.selectedPreview?.provenance);
    expect(after.selectedPreview?.content).toEqual(before.selectedPreview?.content);
  });

  it("F7-13: an exhausted batch share fails the batch visibly while manual Generate still works", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await redis.set(usageKey(E101, day, "batch"), "15");
    await redis.set(usageKey(E101, day, "total"), "15");
    await submit("Over the batch cap.");
    await vi.waitFor(
      async () => {
        expect(await outcomes()).toEqual(["feedback_batch:failed:DAILY_LIMIT_REACHED"]);
      },
      { timeout: 5_000 },
    );
    expect(gateway.requests).toHaveLength(0);
    // The failure is visible to the coordinator (the web shows the failed-batch banner from it).
    const failed = await view();
    expect(failed.generation.batch).toBeNull();
    expect(failed.generation.lastOutcome).toMatchObject({
      trigger: "feedback_batch",
      status: "failed",
      code: "DAILY_LIMIT_REACHED",
    });
    expect((await generate()).status).toBe(201);
  });
});
