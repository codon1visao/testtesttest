import { SUPPLIED_EVENT } from "@event-desk/contracts";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openTestDataSource, truncateAllTables } from "../testing/database.js";
import {
  DEFAULT_ITEMS,
  GENERATION_FIXTURE_ID,
  insertEventFixture,
  insertGenerationFixture,
  insertOutcome,
  insertSavedBriefing,
  OTHER_GENERATION_FIXTURE_ID,
  putPreviewSlot,
} from "../testing/sql-fixtures.js";
import { silentLogger } from "../testing/test-config.js";
import { TypeOrmUnitOfWork } from "./typeorm-unit-of-work.js";

const E101 = SUPPLIED_EVENT.id;
let dataSource: DataSource;
let uow: TypeOrmUnitOfWork;

beforeAll(async () => {
  dataSource = await openTestDataSource();
  uow = new TypeOrmUnitOfWork(dataSource, silentLogger);
});
afterAll(async () => {
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await insertEventFixture(dataSource);
});

const loadSlots = () => uow.readSnapshot((scope) => scope.briefings.loadSlots(E101));

describe("TypeOrmBriefingReadRepository", () => {
  it("returns empty slots when nothing was generated", async () => {
    expect(await loadSlots()).toEqual({ saved: null, selected: null, incoming: null });
  });

  it("maps an incoming generation with its references", async () => {
    await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", GENERATION_FIXTURE_ID);
    const slots = await loadSlots();
    expect(slots.saved).toBeNull();
    expect(slots.selected).toBeNull();
    expect(slots.incoming?.provenance.generationId).toBe(GENERATION_FIXTURE_ID);
    expect(slots.incoming?.content.feedbackSummary.sourceIds).toEqual([
      "F01",
      "F02",
      "F03",
      "F04",
      "F05",
      "F06",
      "F07",
      "F08",
    ]);
    expect(slots.incoming?.content.themes).toEqual([
      { text: "Requests for more rest-break time.", sourceIds: ["F05", "F06"] },
    ]);
    expect(slots.incoming?.provenance.input.counts).toEqual({
      registered: 4,
      attended: 1,
      absent: 2,
      notRecorded: 1,
    });
  });

  it("maps the saved briefing's human wording alongside a separate selected preview", async () => {
    await insertGenerationFixture(dataSource);
    await insertGenerationFixture(dataSource, {
      id: OTHER_GENERATION_FIXTURE_ID,
      items: DEFAULT_ITEMS.map((item, i) => ({
        ...item,
        id: `0199a4e8-0000-7000-8000-00000000010${i}`,
      })),
    });
    await insertSavedBriefing(dataSource, {
      generationId: GENERATION_FIXTURE_ID,
      attendanceOverview: "Edited overview.",
      itemTexts: Object.fromEntries(DEFAULT_ITEMS.map((item) => [item.id, `Edited: ${item.text}`])),
    });
    await putPreviewSlot(dataSource, "selected", OTHER_GENERATION_FIXTURE_ID);
    const slots = await loadSlots();
    expect(slots.saved?.content.attendanceOverview).toBe("Edited overview.");
    expect(slots.saved?.content.themes[0]).toEqual({
      text: "Edited: Requests for more rest-break time.",
      sourceIds: ["F05", "F06"],
    });
    expect(slots.saved?.savedAt).toBe("2026-10-03T09:00:00.000Z");
    expect(slots.selected?.provenance.generationId).toBe(OTHER_GENERATION_FIXTURE_ID);
    expect(slots.selected?.content.themes[0]?.text).toBe("Requests for more rest-break time.");
  });
});

describe("TypeOrmOutcomeReadRepository", () => {
  it("returns the most recent outcome, with its code when it failed", async () => {
    expect(await uow.readSnapshot((scope) => scope.outcomes.latest(E101))).toBeNull();
    await insertOutcome(dataSource, {
      runId: "1",
      trigger: "feedback_batch",
      status: "skipped",
      finishedAt: new Date("2026-10-03T09:00:00.000Z"),
    });
    await insertOutcome(dataSource, {
      runId: "2",
      trigger: "feedback_batch",
      status: "failed",
      errorCode: "GATEWAY_UNAVAILABLE",
      finishedAt: new Date("2026-10-03T09:05:00.000Z"),
    });
    expect(await uow.readSnapshot((scope) => scope.outcomes.latest(E101))).toEqual({
      runId: "2",
      trigger: "feedback_batch",
      status: "failed",
      code: "GATEWAY_UNAVAILABLE",
      finishedAt: "2026-10-03T09:05:00.000Z",
    });
  });
});
