import {
  deriveAttendanceCounts,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TypeOrmUnitOfWork } from "../repositories/typeorm-unit-of-work.js";
import { openTestDataSource, truncateAllTables } from "../testing/database.js";
import { silentLogger } from "../testing/test-config.js";
import { seedIfMissing } from "./seed.js";
import { bootstrapStore } from "./store-bootstrap.js";

const NOW = new Date("2026-10-03T10:00:00.000Z");
let dataSource: DataSource;
let uow: TypeOrmUnitOfWork;

const countOf = async (table: string) => {
  const [row] = await dataSource.query<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(row?.n);
};

beforeAll(async () => {
  dataSource = await openTestDataSource();
  uow = new TypeOrmUnitOfWork(dataSource, silentLogger);
});
afterAll(async () => {
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
});

describe("seedIfMissing (TX1)", () => {
  it("F1-01: initialises the exact supplied records once", async () => {
    expect(await seedIfMissing(dataSource, NOW)).toBe("seeded");
    const aggregate = await uow.readSnapshot((scope) =>
      scope.events.findAggregate(SUPPLIED_EVENT.id),
    );
    expect(aggregate?.event).toEqual(SUPPLIED_EVENT);
    expect(aggregate?.members).toEqual(SUPPLIED_MEMBERS);
    expect(aggregate?.feedback.map((n) => [n.id, n.text])).toEqual(
      SUPPLIED_FEEDBACK.map((n) => [n.id, n.text]),
    );
    expect(deriveAttendanceCounts(aggregate?.members ?? [])).toEqual({
      registered: 4,
      attended: 1,
      absent: 2,
      notRecorded: 1,
    });
    expect(aggregate?.attendanceRevision).toBe(0);
    expect(aggregate?.briefingRevision).toBe(0);
    const [event] = await dataSource.query<{ next_feedback_number: number }[]>(
      "SELECT next_feedback_number FROM events",
    );
    expect(event?.next_feedback_number).toBe(9);
    expect(await countOf("briefing_generations")).toBe(0);
  });

  it("F1-04: repeated starts never duplicate or overwrite saved data", async () => {
    await seedIfMissing(dataSource, NOW);
    await dataSource.query("UPDATE members SET attendance = 'attended' WHERE id = 'M03'");
    expect(await seedIfMissing(dataSource, NOW)).toBe("existing");
    expect(await countOf("events")).toBe(1);
    expect(await countOf("members")).toBe(4);
    expect(await countOf("feedback_notes")).toBe(8);
    const [chris] = await dataSource.query<{ attendance: string }[]>(
      "SELECT attendance FROM members WHERE id = 'M03'",
    );
    expect(chris?.attendance).toBe("attended");
  });

  it("F1-05: never reseeds over an incomplete store", async () => {
    await seedIfMissing(dataSource, NOW);
    await dataSource.query("DELETE FROM feedback_notes");
    await dataSource.query("DELETE FROM members");
    expect(await seedIfMissing(dataSource, NOW)).toBe("existing");
    expect(await countOf("members")).toBe(0);
    await expect(
      uow.readSnapshot((scope) => scope.events.findAggregate(SUPPLIED_EVENT.id)),
    ).rejects.toMatchObject({
      code: "STORE_CORRUPT",
    });
  });
});

describe("seedIfMissing duplicate-key handling (TX1)", () => {
  it("TX1 race: two concurrent seeders on an empty store seed exactly once", async () => {
    const results = await Promise.all([
      seedIfMissing(dataSource, NOW),
      seedIfMissing(dataSource, NOW),
    ]);
    expect([...results].sort()).toEqual(["existing", "seeded"]);
    expect(await countOf("events")).toBe(1);
    expect(await countOf("members")).toBe(4);
    expect(await countOf("feedback_notes")).toBe(8);
  });

  it("TX1: a duplicate on a child insert is rethrown, not reported as existing", async () => {
    // An orphan member (no E101 event row) can only exist with FK checks off. The event insert then
    // succeeds and the members insert hits a duplicate key, which must roll back and surface.
    const runner = dataSource.createQueryRunner();
    try {
      await runner.query("SET FOREIGN_KEY_CHECKS = 0");
      try {
        await runner.query(
          "INSERT INTO members (event_id, id, name, attendance, display_order) VALUES ('E101', 'M01', 'Orphan', 'attended', 1)",
        );
      } finally {
        await runner.query("SET FOREIGN_KEY_CHECKS = 1");
      }
    } finally {
      await runner.release();
    }
    await expect(seedIfMissing(dataSource, NOW)).rejects.toMatchObject({
      driverError: { errno: 1062 },
    });
    expect(await countOf("events")).toBe(0);
    expect(await countOf("feedback_notes")).toBe(0);
  });
});

describe("bootstrapStore", () => {
  it("is idempotent: migrations already applied, data already seeded", async () => {
    await bootstrapStore(dataSource, silentLogger, NOW);
    await bootstrapStore(dataSource, silentLogger, NOW);
    expect(await countOf("events")).toBe(1);
  });
});
