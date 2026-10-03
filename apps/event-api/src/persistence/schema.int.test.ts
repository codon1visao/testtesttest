import type { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { APPLICATION_TABLES, openTestDataSource, truncateAllTables } from "../testing/database.js";
import {
  DEFAULT_ITEMS,
  GENERATION_FIXTURE_ID,
  insertEventFixture,
  insertGenerationFixture,
  insertSavedBriefing,
  OTHER_GENERATION_FIXTURE_ID,
  putPreviewSlot,
} from "../testing/sql-fixtures.js";

const ER_NO_REFERENCED_ROW_2 = 1452;
const ER_ROW_IS_REFERENCED_2 = 1451;
const ER_CHECK_CONSTRAINT_VIOLATED = 3819;

const rejectsWith = (promise: Promise<unknown>, errno: number) =>
  expect(promise).rejects.toMatchObject({ driverError: { errno } });

const [summaryItem, themeItem] = DEFAULT_ITEMS;
if (summaryItem === undefined || themeItem === undefined) throw new Error("fixture items missing");

let dataSource: DataSource;

beforeAll(async () => {
  dataSource = await openTestDataSource();
});
afterAll(async () => {
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await insertEventFixture(dataSource);
});

describe("T4 schema", () => {
  it("creates every table from the DDL", async () => {
    const rows = await dataSource.query<{ TABLE_NAME: string }[]>(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
    );
    const tables = rows.map((r) => r.TABLE_NAME);
    for (const table of APPLICATION_TABLES) expect(tables).toContain(table);
  });

  it("T4-01: rejects a citation of a note outside the generation's input", async () => {
    await insertGenerationFixture(dataSource, {
      feedbackIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07"],
      items: [
        { ...themeItem, sourceIds: ["F05", "F06"] },
        { ...summaryItem, sourceIds: ["F01"] },
      ],
    });
    await rejectsWith(
      dataSource.query(
        "INSERT INTO briefing_item_sources (item_id, generation_id, feedback_id, position) VALUES (?, ?, 'F08', 2)",
        [themeItem.id, GENERATION_FIXTURE_ID],
      ),
      ER_NO_REFERENCED_ROW_2,
    );
  });

  it("T4-02: a saved text row cannot point at another generation's item", async () => {
    await insertGenerationFixture(dataSource);
    await insertGenerationFixture(dataSource, {
      id: OTHER_GENERATION_FIXTURE_ID,
      items: DEFAULT_ITEMS.map((item, i) => ({
        ...item,
        id: `0199a4e8-0000-7000-8000-00000000010${i}`,
      })),
    });
    await rejectsWith(
      insertSavedBriefing(dataSource, {
        generationId: GENERATION_FIXTURE_ID,
        attendanceOverview: "Edited overview.",
        itemTexts: { "0199a4e8-0000-7000-8000-000000000100": "Belongs to the other generation." },
      }),
      ER_NO_REFERENCED_ROW_2,
    );
  });

  it("T4-03: a referenced generation cannot be deleted; an unreferenced one cascades", async () => {
    await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", GENERATION_FIXTURE_ID);
    await rejectsWith(
      dataSource.query("DELETE FROM briefing_generations WHERE id = ?", [GENERATION_FIXTURE_ID]),
      ER_ROW_IS_REFERENCED_2,
    );
    await dataSource.query("DELETE FROM preview_slots");
    await dataSource.query("DELETE FROM briefing_generations WHERE id = ?", [
      GENERATION_FIXTURE_ID,
    ]);
    for (const table of [
      "briefing_items",
      "briefing_item_sources",
      "generation_feedback_inputs",
      "generation_attendance_inputs",
    ]) {
      const [row] = await dataSource.query<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`);
      expect(Number(row?.n)).toBe(0);
    }
  });

  it("T4-10: IDs match exactly (binary collation)", async () => {
    const lower = await dataSource.query<unknown[]>(
      "SELECT id FROM feedback_notes WHERE id = 'f01'",
    );
    const exact = await dataSource.query<unknown[]>(
      "SELECT id FROM feedback_notes WHERE id = 'F01'",
    );
    expect(lower).toHaveLength(0);
    expect(exact).toHaveLength(1);
  });

  it("T4-11: blank text fails the CHECK constraints", async () => {
    await rejectsWith(
      dataSource.query(
        "INSERT INTO feedback_notes (event_id, id, text, origin, submission_id, received_at, display_order) VALUES ('E101', 'F09', '   ', 'submitted', UUID(), NOW(3), 9)",
      ),
      ER_CHECK_CONSTRAINT_VIOLATED,
    );
    await rejectsWith(
      insertGenerationFixture(dataSource, { items: [{ ...summaryItem, text: "   " }] }),
      ER_CHECK_CONSTRAINT_VIOLATED,
    );
  });

  it("allows one feedback summary, at position 0, within 600 characters", async () => {
    await rejectsWith(
      insertGenerationFixture(dataSource, { items: [{ ...summaryItem, position: 1 }] }),
      ER_CHECK_CONSTRAINT_VIOLATED,
    );
    await truncateAllTables(dataSource);
    await insertEventFixture(dataSource);
    await rejectsWith(
      insertGenerationFixture(dataSource, { items: [{ ...summaryItem, text: "x".repeat(601) }] }),
      ER_CHECK_CONSTRAINT_VIOLATED,
    );
  });

  it("requires an error code exactly when an outcome failed", async () => {
    await rejectsWith(
      dataSource.query(
        "INSERT INTO generation_outcomes (run_id, event_id, trigger_type, status, finished_at) VALUES ('r1', 'E101', 'manual', 'failed', NOW(3))",
      ),
      ER_CHECK_CONSTRAINT_VIOLATED,
    );
  });
});
