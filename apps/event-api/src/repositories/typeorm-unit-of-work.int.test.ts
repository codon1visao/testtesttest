import {
  EventIdSchema,
  MemberIdSchema,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import { setTimeout as sleep } from "node:timers/promises";
import type { DataSource, EntityManager } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDataSource } from "../persistence/data-source.js";
import { AppError } from "../shared/app-error.js";
import { openTestDataSource, truncateAllTables } from "../testing/database.js";
import { insertEventFixture } from "../testing/sql-fixtures.js";
import { silentLogger, testMysqlUrl } from "../testing/test-config.js";
import { TypeOrmUnitOfWork } from "./typeorm-unit-of-work.js";

const E101 = SUPPLIED_EVENT.id;
const E999 = EventIdSchema.parse("E999");
const M03 = MemberIdSchema.parse("M03");
let dataSource: DataSource;
let uow: TypeOrmUnitOfWork;

const chrisStatus = async () => {
  const [row] = await dataSource.query<{ attendance: string }[]>(
    "SELECT attendance FROM members WHERE event_id = ? AND id = ?",
    [E101, M03],
  );
  return row?.attendance;
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
  await insertEventFixture(dataSource);
});

/** Exposes the manager of the read-only transaction so a test can ask the server about it. */
class ManagerCapturingUnitOfWork extends TypeOrmUnitOfWork {
  captured: EntityManager | undefined;
  protected override readScope(manager: EntityManager) {
    this.captured = manager;
    return super.readScope(manager);
  }
}

describe("TypeOrmUnitOfWork + TypeOrmEventRepository", () => {
  it("reads the aggregate in a read-only snapshot", async () => {
    const aggregate = await uow.readSnapshot((scope) => scope.events.findAggregate(E101));
    expect(aggregate?.event).toEqual(SUPPLIED_EVENT);
    expect(aggregate?.members).toEqual(SUPPLIED_MEMBERS);
    expect(aggregate?.feedback.map((n) => [n.id, n.text])).toEqual(
      SUPPLIED_FEEDBACK.map((n) => [n.id, n.text]),
    );
    expect(aggregate?.attendanceRevision).toBe(0);
  });

  it("returns null for an unknown event", async () => {
    expect(await uow.readSnapshot((scope) => scope.events.findAggregate(E999))).toBeNull();
  });

  it("commits changes, bumps the revision and runs afterCommit effects after the commit", async () => {
    const seenByEffect: (string | undefined)[] = [];
    await uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      await tx.events.applyAttendanceChanges(E101, [
        { memberId: M03, from: "not_recorded", to: "attended" },
      ]);
      tx.afterCommit(async () => {
        seenByEffect.push(await chrisStatus());
      });
    });
    expect(seenByEffect).toEqual(["attended"]);
    const [event] = await dataSource.query<{ attendance_revision: number }[]>(
      "SELECT attendance_revision FROM events WHERE id = ?",
      [E101],
    );
    expect(event?.attendance_revision).toBe(1);
  });

  it("rolls back everything and skips effects when the work throws", async () => {
    let effectRan = false;
    const failure = uow.run(async (tx) => {
      await tx.events.applyAttendanceChanges(E101, [
        { memberId: M03, from: "not_recorded", to: "attended" },
      ]);
      tx.afterCommit(() => {
        effectRan = true;
        return Promise.resolve();
      });
      throw new AppError("ATTENDANCE_CONFLICT", "stale");
    });
    await expect(failure).rejects.toMatchObject({ code: "ATTENDANCE_CONFLICT" });
    expect(effectRan).toBe(false);
    expect(await chrisStatus()).toBe("not_recorded");
  });

  it("serialises writers on the event row lock (T4 §6)", async () => {
    const order: string[] = [];
    const first = uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      order.push("first locked");
      await sleep(300);
      order.push("first done");
    });
    while (!order.includes("first locked")) await sleep(10);
    const second = uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      order.push("second locked");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first locked", "first done", "second locked"]);
  });

  it("answers EVENT_NOT_FOUND when locking an unknown event", async () => {
    await expect(uow.run((tx) => tx.events.lockForUpdate(E999))).rejects.toMatchObject({
      code: "EVENT_NOT_FOUND",
    });
  });

  it("reports corrupt rows as STORE_CORRUPT instead of inventing data (F1-05)", async () => {
    await dataSource.query("UPDATE members SET name = '' WHERE event_id = ? AND id = ?", [
      E101,
      M03,
    ]);
    await expect(
      uow.readSnapshot((scope) => scope.events.findAggregate(E101)),
    ).rejects.toMatchObject({
      code: "STORE_CORRUPT",
    });
  });

  it("reports an event with no members as STORE_CORRUPT", async () => {
    await dataSource.query("DELETE FROM members WHERE event_id = ?", [E101]);
    await expect(
      uow.readSnapshot((scope) => scope.events.findAggregate(E101)),
    ).rejects.toMatchObject({
      code: "STORE_CORRUPT",
    });
  });

  it("fails fast with STORE_UNAVAILABLE when the store is gone", async () => {
    const gone = createDataSource(testMysqlUrl());
    await gone.initialize();
    await gone.destroy();
    const unavailable = new TypeOrmUnitOfWork(gone, silentLogger);
    await expect(
      unavailable.readSnapshot((scope) => scope.events.findAggregate(E101)),
    ).rejects.toMatchObject({
      code: "STORE_UNAVAILABLE",
    });
  });
  it("reads a REPEATABLE READ snapshot even when the connection defaults to READ COMMITTED (T4 §6)", async () => {
    // A fresh pool holds one connection, so sequential calls reuse it and the session setting sticks.
    const single = createDataSource(testMysqlUrl());
    await single.initialize();
    try {
      const capturing = new ManagerCapturingUnitOfWork(single, silentLogger);
      const managerInTransaction = (): EntityManager => {
        if (capturing.captured === undefined) throw new Error("manager was not captured");
        return capturing.captured;
      };
      await capturing.readSnapshot(async () => {
        await managerInTransaction().query(
          "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED",
        );
      });
      const [session] = await dataSource.query<{ level: string }[]>(
        "SELECT @@session.transaction_isolation AS level",
      );
      expect(session?.level).toBe("REPEATABLE-READ"); // the main pool is untouched

      const names = await capturing.readSnapshot(async () => {
        const manager = managerInTransaction();
        const [defaults] = await manager.query<{ level: string }[]>(
          "SELECT @@session.transaction_isolation AS level",
        );
        const read = () =>
          manager.query<{ name: string }[]>("SELECT name FROM events WHERE id = ?", [E101]);
        const [before] = await read();
        await dataSource.query("UPDATE events SET name = 'Renamed mid-read' WHERE id = ?", [E101]);
        const [after] = await read();
        return { defaults: defaults?.level, before: before?.name, after: after?.name };
      });
      // Precondition: this connection really defaults to READ COMMITTED, which would show the rename.
      expect(names.defaults).toBe("READ-COMMITTED");
      expect(names.after).toBe(names.before);
    } finally {
      await single.destroy();
    }
  });
});
