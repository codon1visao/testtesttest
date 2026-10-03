import {
  EventIdSchema,
  MemberIdSchema,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import { setTimeout as sleep } from "node:timers/promises";
import type { DataSource, EntityManager, QueryRunner } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionScope } from "../ports/unit-of-work.js";
import { createDataSource, MYSQL_POOL_SIZE } from "../persistence/data-source.js";
import { AppError } from "../shared/app-error.js";
import { openTestDataSource, truncateAllTables } from "../testing/database.js";
import { insertEventFixture } from "../testing/sql-fixtures.js";
import { integrationConfig, silentLogger, testMysqlUrl } from "../testing/test-config.js";
import { TypeOrmUnitOfWork } from "./typeorm-unit-of-work.js";

const E101 = SUPPLIED_EVENT.id;
const E999 = EventIdSchema.parse("E999");
const M03 = MemberIdSchema.parse("M03");
const { mysqlQueryTimeoutMs } = integrationConfig();
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
  uow = new TypeOrmUnitOfWork(dataSource, silentLogger, { queryTimeoutMs: mysqlQueryTimeoutMs });
});
afterAll(async () => {
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await insertEventFixture(dataSource);
});

/** Exposes the manager of the current transaction so a test can ask the server about it. */
class ManagerCapturingUnitOfWork extends TypeOrmUnitOfWork {
  captured: EntityManager | undefined;
  protected override readScope(manager: EntityManager) {
    this.captured = manager;
    return super.readScope(manager);
  }
  protected override transactionScope(
    manager: EntityManager,
    effects: (() => Promise<void>)[],
  ): TransactionScope {
    this.captured = manager;
    return super.transactionScope(manager, effects);
  }
  manager(): EntityManager {
    if (this.captured === undefined) throw new Error("manager was not captured");
    return this.captured;
  }
}

/** Opens a data source whose queries time out after `queryTimeoutMs`, and its unit of work. */
async function openTimedStore(queryTimeoutMs: number) {
  const store = createDataSource(testMysqlUrl(), { queryTimeoutMs });
  await store.initialize();
  return { store, timed: new ManagerCapturingUnitOfWork(store, silentLogger, { queryTimeoutMs }) };
}

async function connectRunners(store: DataSource, count: number): Promise<QueryRunner[]> {
  const runners = Array.from({ length: count }, () => store.createQueryRunner());
  await Promise.all(runners.map((runner) => runner.connect()));
  return runners;
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

  it("treats an empty change list as a no-op that leaves the revision alone", async () => {
    await uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      await tx.events.applyAttendanceChanges(E101, []);
    });
    const [event] = await dataSource.query<{ attendance_revision: number }[]>(
      "SELECT attendance_revision FROM events WHERE id = ?",
      [E101],
    );
    expect(event?.attendance_revision).toBe(0);
  });

  it("lets a queued writer see the committed state of the writer ahead of it (snapshot taken after the lock)", async () => {
    const firstLock = { held: false };
    const first = uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      firstLock.held = true;
      await tx.events.applyAttendanceChanges(E101, [
        { memberId: M03, from: "not_recorded", to: "attended" },
      ]);
      await sleep(300);
    });
    // Poll until the first writer holds the lock, but fail fast if it rejects instead.
    await Promise.race([
      first,
      (async () => {
        while (!firstLock.held) await sleep(10);
      })(),
    ]);
    const second = await uow.run(async (tx) => {
      const aggregate = await tx.events.lockForUpdate(E101);
      return {
        revision: aggregate.attendanceRevision,
        chris: aggregate.members.find((m) => m.id === M03)?.attendance,
      };
    });
    await first;
    expect(second).toEqual({ revision: 1, chris: "attended" });
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
    const gone = createDataSource(testMysqlUrl(), { queryTimeoutMs: mysqlQueryTimeoutMs });
    await gone.initialize();
    await gone.destroy();
    const unavailable = new TypeOrmUnitOfWork(gone, silentLogger, {
      queryTimeoutMs: mysqlQueryTimeoutMs,
    });
    await expect(
      unavailable.readSnapshot((scope) => scope.events.findAggregate(E101)),
    ).rejects.toMatchObject({
      code: "STORE_UNAVAILABLE",
    });
  });
  it("reads a REPEATABLE READ snapshot even when the connection defaults to READ COMMITTED (T4 §6)", async () => {
    // A fresh pool holds one connection, so sequential calls reuse it and the session setting sticks.
    const single = createDataSource(testMysqlUrl(), { queryTimeoutMs: mysqlQueryTimeoutMs });
    await single.initialize();
    try {
      const capturing = new ManagerCapturingUnitOfWork(single, silentLogger, {
        queryTimeoutMs: mysqlQueryTimeoutMs,
      });
      const managerInTransaction = () => capturing.manager();
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

describe("TypeOrmUnitOfWork deadlines (MYSQL_QUERY_TIMEOUT_MS)", () => {
  it("bounds row-lock waits in every write transaction by the query timeout, in whole seconds", async () => {
    const { store, timed } = await openTimedStore(1_500);
    try {
      const seconds = await timed.run(async (tx) => {
        await tx.events.lockForUpdate(E101);
        const [row] = await timed
          .manager()
          .query<{ seconds: number }[]>("SELECT @@session.innodb_lock_wait_timeout AS seconds");
        return Number(row?.seconds);
      });
      expect(seconds).toBe(2);
    } finally {
      await store.destroy();
    }
  });

  it("abandons a query that outlives the timeout without waiting for it, and discards its connection", async () => {
    const consoleSpies = (["log", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { store, timed } = await openTimedStore(500);
    try {
      const started = Date.now();
      const failure = timed.readSnapshot(() =>
        timed.manager().query("SELECT SLEEP(?) AS slept, ? AS note", [3, "Secret feedback text"]),
      );
      await expect(failure).rejects.toMatchObject({
        code: "STORE_UNAVAILABLE",
        message: "The event store is busy. Try again shortly.",
      });
      // A rollback queued behind the sleeping query would only answer after 3 s.
      expect(Date.now() - started).toBeLessThan(1_500);

      const next = Date.now();
      expect(await timed.readSnapshot((scope) => scope.events.findAggregate(E101))).not.toBeNull();
      // The pool must not hand out the connection that is still busy sleeping.
      expect(Date.now() - next).toBeLessThan(1_000);
      // TypeORM logs slow queries with their parameters to the console unless told not to.
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
      await store.destroy();
    }
  });

  it("stops waiting for a pooled connection at the deadline, and returns it once it arrives", async () => {
    const { store, timed } = await openTimedStore(500);
    let held = await connectRunners(store, MYSQL_POOL_SIZE);
    try {
      const started = Date.now();
      await expect(
        timed.readSnapshot((scope) => scope.events.findAggregate(E101)),
      ).rejects.toMatchObject({
        code: "STORE_UNAVAILABLE",
        message: "The event store is busy. Try again shortly.",
      });
      expect(Date.now() - started).toBeLessThan(1_500);

      await Promise.all(held.map((runner) => runner.release()));
      await sleep(50);
      // The late connection went back to the pool: the whole pool can be checked out again.
      held = await Promise.race([
        connectRunners(store, MYSQL_POOL_SIZE),
        sleep(2_000).then(() => Promise.reject(new Error("a pooled connection leaked"))),
      ]);
    } finally {
      await Promise.all(held.map((runner) => runner.release()));
      await store.destroy();
    }
  });
});
