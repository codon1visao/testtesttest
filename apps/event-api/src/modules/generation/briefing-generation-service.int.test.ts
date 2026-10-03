import {
  RunIdSchema,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  type BriefingView,
} from "@event-desk/contracts";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { uuidV7IdGenerator } from "../../integrations/uuid-v7-id-generator.js";
import type {
  AiGatewayClient,
  BriefingCallRequest,
  BriefingCallResult,
} from "../../ports/ai-gateway-client.js";
import type { IdGenerator } from "../../ports/id-generator.js";
import type { UnitOfWork } from "../../ports/unit-of-work.js";
import { TypeOrmUnitOfWork } from "../../repositories/typeorm-unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import { openTestDataSource, truncateAllTables } from "../../testing/database.js";
import { FakeGenerationLimits } from "../../testing/fake-generation-limits.js";
import {
  insertEventFixture,
  insertGenerationFixture,
  putPreviewSlot,
} from "../../testing/sql-fixtures.js";
import { silentLogger } from "../../testing/test-config.js";
import { BriefingGenerationService } from "./briefing-generation-service.js";

const E101 = SUPPLIED_EVENT.id;
const NOW = new Date("2026-10-04T10:00:00.000Z");
let dataSource: DataSource;
let uow: TypeOrmUnitOfWork;

const okSections = {
  feedbackSummary: { text: "Notes describe an enjoyable walk.", sourceIds: ["F01", "F08"] },
  themes: [{ text: "Requests for longer rest breaks.", sourceIds: ["F05", "F06"] }],
  conflicts: [
    {
      text: "One note asks to start earlier; another note says that would be difficult.",
      sourceIds: ["F03", "F04"],
    },
  ],
  suggestions: [{ text: "Consider checking the route length.", sourceIds: ["F07"] }],
};
const result = (sections: unknown = okSections): BriefingCallResult => ({
  ok: true,
  result: {
    sections: sections as never,
    model: "fake-model",
    promptVersion: "fake-prompt.v1",
    providerRequestId: "resp_1",
    usage: { inputTokens: 1, outputTokens: 1 },
  },
});

function setup(
  answer: (request: BriefingCallRequest) => Promise<BriefingCallResult>,
  overrides: {
    ids?: IdGenerator;
    now?: () => Date;
    uow?: UnitOfWork;
    publish?: () => Promise<void>;
    limits?: FakeGenerationLimits;
  } = {},
) {
  const calls: BriefingCallRequest[] = [];
  const gateway: AiGatewayClient = {
    generateBriefing: (request) => {
      calls.push(request);
      return answer(request);
    },
  };
  const publish = vi.fn(overrides.publish ?? (() => Promise.resolve()));
  const service = new BriefingGenerationService({
    uow: overrides.uow ?? uow,
    gateway,
    ids: overrides.ids ?? uuidV7IdGenerator,
    clock: { now: overrides.now ?? (() => NOW) },
    changes: { publish },
    logger: silentLogger,
    limits: overrides.limits ?? new FakeGenerationLimits(),
  });
  const command = (baseAttendanceRevision = 0) => ({
    eventId: E101,
    runId: RunIdSchema.parse(`manual:test-${Math.random().toString(36).slice(2)}`),
    baseAttendanceRevision,
    deadlineAt: new Date(NOW.getTime() + 60_000),
  });
  return { service, calls, publish, command };
}

async function appErrorOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError");
}
const rows = async (sql: string) => dataSource.query<Record<string, unknown>[]>(sql);
const count = async (table: string) =>
  Number((await dataSource.query<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n);
const outcomes = () =>
  rows("SELECT status, error_code, generation_id FROM generation_outcomes ORDER BY finished_at");
/** The seeded incoming preview is still the only slot, and its generation row still exists. */
async function expectIncomingSurvives(generationId: string): Promise<void> {
  expect(await rows("SELECT slot, generation_id FROM preview_slots")).toEqual([
    { slot: "incoming", generation_id: generationId },
  ]);
  expect(await rows("SELECT id FROM briefing_generations")).toEqual([{ id: generationId }]);
}

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

describe("BriefingGenerationService.generateManual", () => {
  it("F4-01/F4-02: captures the saved input, calls the interactive lane and commits the incoming preview", async () => {
    const { service, calls, publish, command } = setup(() => Promise.resolve(result()));
    const preview: BriefingView = await service.generateManual(command());

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ attemptId: "1", lane: "interactive" });
    expect(calls[0]?.input.counts).toEqual({
      registered: 4,
      attended: 1,
      absent: 2,
      notRecorded: 1,
    });
    expect(calls[0]?.input.feedback.map((n) => n.id)).toEqual(SUPPLIED_FEEDBACK.map((n) => n.id));
    expect(JSON.stringify(calls[0]?.input)).not.toMatch(/Alex|Bea|Chris|Drew/); // S1: no roster names

    expect(preview.trigger).toBe("manual");
    expect(preview.content.attendanceOverview).toBe(
      "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
    );
    expect(preview.content.themes).toEqual(okSections.themes);
    expect(preview.freshness.current).toBe(true);
    expect(preview.provenance).toMatchObject({
      model: "fake-model",
      promptVersion: "fake-prompt.v1",
      generatedAt: NOW.toISOString(),
    });
    expect(await outcomes()).toEqual([
      { status: "succeeded", error_code: null, generation_id: preview.provenance.generationId },
    ]);
    expect(await rows("SELECT slot FROM preview_slots")).toEqual([{ slot: "incoming" }]);
    expect(publish).toHaveBeenCalledWith(E101);
  });

  it("checks the attendance baseline before any paid call", async () => {
    const { service, calls, command } = setup(() => Promise.resolve(result()));
    expect((await appErrorOf(service.generateManual(command(7)))).code).toBe("ATTENDANCE_CONFLICT");
    expect(calls).toHaveLength(0);
    expect(await outcomes()).toEqual([]);
  });

  it("F4-06: maps a Gateway failure, records the outcome and keeps every slot as it was", async () => {
    const previous = await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", previous);
    const { service, publish, command } = setup(() =>
      Promise.resolve({ ok: false, code: "PROVIDER_REFUSED", notSent: false }),
    );
    const error = await appErrorOf(service.generateManual(command()));
    expect(error.code).toBe("PROVIDER_REFUSED");
    expect(await outcomes()).toEqual([
      { status: "failed", error_code: "PROVIDER_REFUSED", generation_id: null },
    ]);
    await expectIncomingSurvives(previous);
    expect(publish).toHaveBeenCalledWith(E101);
  });

  it.each([
    [
      "cites a note outside the captured set",
      { ...okSections, suggestions: [{ text: "Consider it.", sourceIds: ["F09"] }] },
    ],
    [
      "has a theme with one distinct note (F4-12)",
      { ...okSections, themes: [{ text: "Rest.", sourceIds: ["F05", "F05"] }] },
    ],
    [
      "has a one-sided conflict (F4-15)",
      { ...okSections, conflicts: [{ text: "Start time.", sourceIds: ["F03"] }] },
    ],
    [
      "has a blank summary",
      { ...okSections, feedbackSummary: { text: "   ", sourceIds: ["F01"] } },
    ],
  ])("F4-04: rejects a candidate that %s without storing it", async (_name, sections) => {
    const { service, command } = setup(() => Promise.resolve(result(sections)));
    expect((await appErrorOf(service.generateManual(command()))).code).toBe("OUTPUT_INVALID");
    expect(await rows("SELECT id FROM briefing_generations")).toEqual([]);
    expect(await outcomes()).toEqual([
      { status: "failed", error_code: "OUTPUT_INVALID", generation_id: null },
    ]);
  });

  it("F8-08: discards a result that arrives after the deadline", async () => {
    let now = NOW;
    const { service, command } = setup(
      () => {
        now = new Date(NOW.getTime() + 61_000);
        return Promise.resolve(result());
      },
      { now: () => now },
    );
    expect((await appErrorOf(service.generateManual(command()))).code).toBe("DEADLINE_EXCEEDED");
    expect(await rows("SELECT id FROM briefing_generations")).toEqual([]);
    expect(await outcomes()).toEqual([
      { status: "failed", error_code: "DEADLINE_EXCEEDED", generation_id: null },
    ]);
  });

  it("replaces the previous incoming preview and removes it, but never a referenced one", async () => {
    const old = await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", old);
    const { service, command } = setup(() => Promise.resolve(result()));
    const first = await service.generateManual(command());
    expect(await rows(`SELECT id FROM briefing_generations WHERE id = '${old}'`)).toEqual([]);

    await dataSource.query("UPDATE preview_slots SET slot = 'selected' WHERE generation_id = ?", [
      first.provenance.generationId,
    ]);
    const second = await service.generateManual(command());
    expect(second.provenance.generationId).not.toBe(first.provenance.generationId);
    // `slot` is ENUM('selected','incoming'): ORDER BY sorts by declaration index.
    expect(await rows("SELECT slot, generation_id FROM preview_slots ORDER BY slot")).toEqual([
      { slot: "selected", generation_id: first.provenance.generationId },
      { slot: "incoming", generation_id: second.provenance.generationId },
    ]);
  });

  it("F4-08: a candidate stays tied to the attendance it read and is marked stale", async () => {
    const { service, command } = setup(async () => {
      await dataSource.query("UPDATE members SET attendance = 'attended' WHERE id = 'M03'");
      await dataSource.query("UPDATE events SET attendance_revision = attendance_revision + 1");
      return result();
    });
    const preview = await service.generateManual(command());
    expect(preview.provenance.input.counts).toEqual({
      registered: 4,
      attended: 1,
      absent: 2,
      notRecorded: 1,
    });
    expect(preview.freshness.current).toBe(false);
    expect(preview.freshness.attendanceChanges).toEqual([
      { memberId: "M03", from: "not_recorded", to: "attended" },
    ]);
  });

  it("F4-09: a persistence failure is RESULT_PERSIST_FAILED and leaves every slot intact", async () => {
    const sameItemId: IdGenerator = {
      ...uuidV7IdGenerator,
      itemId: () => "0199a4e8-7c1a-7cc2-9d6e-000000000001",
    };
    const previous = await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", previous);
    const { service, command } = setup(() => Promise.resolve(result()), { ids: sameItemId });
    expect((await appErrorOf(service.generateManual(command()))).code).toBe(
      "RESULT_PERSIST_FAILED",
    );
    await expectIncomingSurvives(previous);
    expect(await outcomes()).toEqual([
      { status: "failed", error_code: "RESULT_PERSIST_FAILED", generation_id: null },
    ]);
  });

  it("TX6: a failed outcome write and a failed fallback flush never hide the original error", async () => {
    const brokenWrites: UnitOfWork = {
      readSnapshot: (work) => uow.readSnapshot(work),
      run: () => Promise.reject(new Error("MySQL write failed")),
    };
    const { service, publish, command } = setup(
      () => Promise.resolve({ ok: false, code: "PROVIDER_REFUSED", notSent: false }),
      { uow: brokenWrites, publish: () => Promise.reject(new Error("publish failed")) },
    );
    expect((await appErrorOf(service.generateManual(command()))).code).toBe("PROVIDER_REFUSED");
    expect(publish).toHaveBeenCalledWith(E101);
  });
});

describe("limits on the manual path", () => {
  it("an active cooldown is 429 PROVIDER_COOLDOWN with no call and no outcome", async () => {
    const limits = new FakeGenerationLimits();
    limits.cooldownEnd = new Date(NOW.getTime() + 5_000);
    const { service, calls, command } = setup(() => Promise.resolve(result()), { limits });
    await expect(service.generateManual(command())).rejects.toMatchObject({
      code: "PROVIDER_COOLDOWN",
      retryAfterMs: 5_000,
    });
    expect(calls).toHaveLength(0);
    expect(await count("generation_outcomes")).toBe(0);
  });

  it("releases the reservation when the Gateway says the request was not sent", async () => {
    const limits = new FakeGenerationLimits();
    const { service, command } = setup(
      () => Promise.resolve({ ok: false, code: "GATEWAY_UNAVAILABLE", notSent: true }),
      { limits },
    );
    await expect(service.generateManual(command())).rejects.toBeInstanceOf(AppError);
    expect(limits.used).toEqual({ total: 0, batch: 0 });
  });
});
