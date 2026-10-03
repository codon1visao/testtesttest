import { GenerationIdSchema, SUPPLIED_EVENT } from "@event-desk/contracts";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openTestDataSource, truncateAllTables } from "../testing/database.js";
import {
  DEFAULT_ITEMS,
  insertEventFixture,
  insertGenerationFixture,
} from "../testing/sql-fixtures.js";
import { silentLogger } from "../testing/test-config.js";
import { TypeOrmUnitOfWork } from "./typeorm-unit-of-work.js";

const E101 = SUPPLIED_EVENT.id;
const NOW = new Date("2026-10-04T12:00:00.000Z");
let dataSource: DataSource;
let uow: TypeOrmUnitOfWork;

const generationId = (n: number) =>
  GenerationIdSchema.parse(`0199a4e8-7c1a-7cc2-9d6e-${String(n).padStart(12, "0")}`);
/** A fixture generation whose item IDs are unique to `n`. */
async function insertGeneration(
  n: number,
): Promise<{ id: ReturnType<typeof generationId>; itemIds: string[] }> {
  const items = DEFAULT_ITEMS.map((item, index) => ({
    ...item,
    id: `0199a4e8-0000-7000-8${String(n).padStart(3, "0")}-${String(index).padStart(12, "0")}`,
  }));
  const id = generationId(n);
  await insertGenerationFixture(dataSource, { id, runId: `manual:run-${String(n)}`, items });
  return { id, itemIds: items.map((item) => item.id) };
}
const rows = (sql: string) => dataSource.query<Record<string, unknown>[]>(sql);

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

describe("preview slots (TX7)", () => {
  it("moves a generation from incoming to selected and replaces with the row-alias upsert", async () => {
    const first = await insertGeneration(1);
    const second = await insertGeneration(2);
    await uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      await tx.slots.putIncoming(E101, first.id, NOW);
      await tx.slots.putIncoming(E101, second.id, NOW); // upsert replaces
      expect((await tx.slots.incoming(E101))?.generationId).toBe(second.id);
      await tx.slots.clear(E101, "incoming");
      await tx.slots.putSelected(E101, second.id, NOW);
    });
    const holders = await uow.run(async (tx) => ({
      incoming: await tx.slots.incoming(E101),
      selected: await tx.slots.selected(E101),
    }));
    expect(holders.incoming).toBeNull();
    expect(holders.selected).toMatchObject({ generationId: second.id, trigger: "manual" });
  });
});

describe("generation structure (TX8 input)", () => {
  it("returns items in reading order with sources in citation order, scoped to the event", async () => {
    const { id, itemIds } = await insertGeneration(3);
    const structure = await uow.run((tx) => tx.generations.structure(E101, id));
    expect(structure?.items.map((item) => [item.id, item.section, item.position])).toEqual([
      [itemIds[0], "summary", 0],
      [itemIds[1], "theme", 0],
      [itemIds[2], "conflict", 0],
      [itemIds[3], "suggestion", 0],
    ]);
    expect(structure?.items[1]?.sourceIds).toEqual(["F05", "F06"]);
    expect(structure?.feedbackIds).toHaveLength(8);
    expect(await uow.run((tx) => tx.generations.structure(E101, generationId(99)))).toBeNull();
  });
});

describe("saved briefing writes (TX8)", () => {
  it("replaces the saved wording, keeps references, and lets the replaced generation go", async () => {
    const first = await insertGeneration(4);
    const second = await insertGeneration(5);
    const texts = (ids: string[], prefix: string) =>
      new Map(ids.map((itemId, i) => [itemId, `${prefix} ${String(i)}`]));
    await uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      await tx.savedBriefings.replace({
        eventId: E101,
        generationId: first.id,
        attendanceOverview: "Overview A",
        itemTexts: texts(first.itemIds, "A"),
        savedAt: NOW,
      });
      expect(await tx.generations.deleteIfUnreferenced(E101, first.id)).toBe(false); // the saved briefing holds it
      await tx.savedBriefings.replace({
        eventId: E101,
        generationId: second.id,
        attendanceOverview: "Overview B",
        itemTexts: texts(second.itemIds, "B"),
        savedAt: NOW,
      });
      expect(await tx.generations.deleteIfUnreferenced(E101, first.id)).toBe(true);
      await tx.events.bumpBriefingRevision(E101);
    });
    const saved = await uow.run((tx) => tx.savedBriefings.get(E101));
    expect(saved?.generationId).toBe(second.id);
    expect(saved?.attendanceOverview).toBe("Overview B");
    expect(saved?.itemTexts.get(second.itemIds[1] ?? "")).toBe("B 1");
    expect(await rows("SELECT briefing_revision AS r FROM events")).toEqual([{ r: 1 }]);
    const slots = await uow.readSnapshot((scope) => scope.briefings.loadSlots(E101));
    expect(slots.saved?.content.themes).toEqual([{ text: "B 1", sourceIds: ["F05", "F06"] }]);
  });

  it("returns null when nothing is saved", async () => {
    expect(await uow.run((tx) => tx.savedBriefings.get(E101))).toBeNull();
  });
});
