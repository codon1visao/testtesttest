import {
  FeedbackIdSchema,
  GenerationIdSchema,
  RunIdSchema,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_FEEDBACK_DIGEST,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NewGeneration } from "../ports/unit-of-work.js";
import { openTestDataSource, truncateAllTables } from "../testing/database.js";
import { insertEventFixture } from "../testing/sql-fixtures.js";
import { silentLogger } from "../testing/test-config.js";
import { TypeOrmUnitOfWork } from "./typeorm-unit-of-work.js";

const E101 = SUPPLIED_EVENT.id;
const AT = new Date("2026-10-04T10:00:00.000Z");
let dataSource: DataSource;
let uow: TypeOrmUnitOfWork;

const generation = (n: number, overrides: Partial<NewGeneration> = {}): NewGeneration => ({
  id: GenerationIdSchema.parse(`0199a4e8-7c1a-7cc2-9d6e-${String(n).padStart(12, "0")}`),
  eventId: E101,
  runId: RunIdSchema.parse(`manual:run-${n}`),
  trigger: "manual",
  model: "fake-model",
  promptVersion: "fake-prompt.v1",
  attendanceOverview:
    "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
  feedbackDigest: SUPPLIED_FEEDBACK_DIGEST,
  inputCapturedAt: AT,
  generatedAt: AT,
  attendance: SUPPLIED_MEMBERS.map((m) => ({ memberId: m.id, attendance: m.attendance })),
  feedbackIds: SUPPLIED_FEEDBACK.map((note) => note.id),
  items: [
    {
      id: `item-${n}-0`.padEnd(36, "0"),
      section: "summary",
      position: 0,
      text: "Summary.",
      sourceIds: [FeedbackIdSchema.parse("F01")],
    },
    {
      id: `item-${n}-1`.padEnd(36, "0"),
      section: "theme",
      position: 0,
      text: "Rest breaks.",
      sourceIds: [FeedbackIdSchema.parse("F06"), FeedbackIdSchema.parse("F05")],
    },
  ],
  ...overrides,
});
const count = async (table: string) =>
  Number((await dataSource.query<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n);

beforeAll(async () => {
  dataSource = await openTestDataSource();
  uow = new TypeOrmUnitOfWork(dataSource, silentLogger, { queryTimeoutMs: 5_000 });
});
afterAll(async () => {
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await insertEventFixture(dataSource);
});

describe("generation persistence (T4 TX5/TX6)", () => {
  it("inserts a generation and reads it back through the incoming slot", async () => {
    const g = generation(1);
    await uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      await tx.generations.insert(g);
      await tx.slots.putIncoming(E101, g.id, AT);
    });
    const slots = await uow.readSnapshot((scope) => scope.briefings.loadSlots(E101));
    expect(slots.incoming?.provenance).toMatchObject({
      generationId: g.id,
      runId: g.runId,
      model: "fake-model",
    });
    expect(slots.incoming?.content.themes).toEqual([
      { text: "Rest breaks.", sourceIds: ["F06", "F05"] },
    ]);
    expect(slots.incoming?.content.attendanceOverview).toBe(g.attendanceOverview);
    expect(await uow.run((tx) => tx.slots.incoming(E101))).toEqual({
      generationId: g.id,
      trigger: "manual",
      inputCapturedAt: AT,
    });
    expect(await uow.run((tx) => tx.generations.findIdByRunId(g.runId))).toBe(g.id);
    expect(
      await uow.run((tx) => tx.generations.findIdByRunId(RunIdSchema.parse("manual:none"))),
    ).toBeNull();
  });

  it("T4-01: a source outside the generation's captured notes is rejected by the database", async () => {
    const g = generation(2, { feedbackIds: [FeedbackIdSchema.parse("F01")] });
    await expect(uow.run((tx) => tx.generations.insert(g))).rejects.toThrow();
    expect(await count("briefing_generations")).toBe(0);
  });

  it("T4-03: deletes a replaced generation only once nothing references it", async () => {
    const first = generation(3);
    const second = generation(4, { runId: RunIdSchema.parse("manual:run-4b") });
    await uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      await tx.generations.insert(first);
      await tx.slots.putIncoming(E101, first.id, AT);
      expect(await tx.generations.deleteIfUnreferenced(E101, first.id)).toBe(false);
      await tx.generations.insert(second);
      await tx.slots.putIncoming(E101, second.id, AT);
      expect(await tx.generations.deleteIfUnreferenced(E101, first.id)).toBe(true);
    });
    expect(await count("briefing_generations")).toBe(1);
    expect(await count("briefing_items")).toBe(2);
    expect(await count("generation_feedback_inputs")).toBe(SUPPLIED_FEEDBACK.length);
  });

  it("records outcomes once per run and keeps the latest 20", async () => {
    const outcome = (n: number) => ({
      runId: RunIdSchema.parse(`manual:run-${n}`),
      eventId: E101,
      trigger: "manual" as const,
      status: "failed" as const,
      errorCode: "GATEWAY_UNAVAILABLE" as const,
      generationId: null,
      finishedAt: new Date(AT.getTime() + n * 1_000),
    });
    await uow.run(async (tx) => {
      for (let n = 1; n <= 22; n += 1) await tx.outcomes.record(outcome(n));
      await tx.outcomes.record(outcome(22));
    });
    expect(await count("generation_outcomes")).toBe(20);
    expect(await uow.readSnapshot((scope) => scope.outcomes.latest(E101))).toMatchObject({
      runId: "manual:run-22",
      status: "failed",
    });
    const oldest = await dataSource.query<{ run_id: string }[]>(
      "SELECT run_id FROM generation_outcomes ORDER BY finished_at LIMIT 1",
    );
    expect(oldest[0]?.run_id).toBe("manual:run-3");
  });
});

describe("latestInput (F7 rule 6)", () => {
  it("is null without generations, else the newest by capture time, then by id", async () => {
    expect(await uow.run((tx) => tx.generations.latestInput(E101))).toBeNull();
    const later = new Date(AT.getTime() + 1_000);
    const notes = ["F01", "F05", "F06"].map((id) => FeedbackIdSchema.parse(id));
    await uow.run(async (tx) => {
      await tx.generations.insert(generation(1, { inputCapturedAt: later, feedbackIds: notes }));
      await tx.generations.insert(generation(3));
      await tx.generations.insert(
        generation(2, {
          inputCapturedAt: later,
          feedbackIds: notes,
          attendance: SUPPLIED_MEMBERS.map((m) => ({ memberId: m.id, attendance: "absent" })),
        }),
      );
    });
    const latest = await uow.run((tx) => tx.generations.latestInput(E101));
    expect(latest?.feedbackIds.toSorted()).toEqual(notes);
    expect(latest?.attendance.map((entry) => entry.attendance)).toEqual(
      SUPPLIED_MEMBERS.map(() => "absent"),
    );
  });
});
