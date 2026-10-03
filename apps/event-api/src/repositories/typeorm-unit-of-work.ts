import { assertNever } from "@event-desk/contracts";
import type { DataSource, EntityManager, QueryRunner } from "typeorm";
import { isQueryTimeout } from "../persistence/mysql-errors.js";
import { discardConnection } from "../persistence/pooled-connection.js";
import type { ReadScope, TransactionScope, UnitOfWork } from "../ports/unit-of-work.js";
import type { Logger } from "../shared/logger.js";
import { TypeOrmBriefingReadRepository } from "./briefing-read-repository.js";
import { TypeOrmEventRepository } from "./event-repository.js";
import { TypeOrmFeedbackWriteRepository } from "./feedback-write-repository.js";
import { TypeOrmGenerationWriteRepository } from "./generation-write-repository.js";
import { TypeOrmOutcomeRepository } from "./outcome-repository.js";
import { TypeOrmPreviewSlotRepository } from "./preview-slot-repository.js";
import { TypeOrmSavedBriefingWriteRepository } from "./saved-briefing-write-repository.js";
import { storeBusy, storeUnavailable, toStoreError } from "./store-errors.js";

type Effect = () => Promise<void>;

/**
 * Commits, then runs the after-commit effects. If COMMIT itself fails its outcome is unknown (a
 * timeout may follow a COMMIT the server applied): run them anyway, then rethrow. The effects
 * flush cached views, which is safe when nothing changed (T3 §7). `commit` must reject only for
 * a failed COMMIT, never for failed work: work errors leave no effects to run.
 */
export async function commitThenEffects<T>(
  commit: () => Promise<T>,
  runEffects: () => Promise<void>,
): Promise<T> {
  let value: T;
  try {
    value = await commit();
  } catch (error) {
    await runEffects();
    throw error;
  }
  await runEffects();
  return value;
}

type Acquisition =
  { kind: "connected" } | { kind: "failed"; error: unknown } | { kind: "timed-out" };

export interface UnitOfWorkOptions {
  /** MYSQL_QUERY_TIMEOUT_MS: also bounds row-lock waits and waiting for a pooled connection. */
  queryTimeoutMs: number;
}

/** InnoDB REPEATABLE READ transactions on one pooled connection; side effects only after COMMIT (T4 §6–7). */
export class TypeOrmUnitOfWork implements UnitOfWork {
  private readonly acquireTimeoutMs: number;
  private readonly lockWaitSeconds: number;
  /** Runners whose connection saw a query timeout and must not go back to the pool. */
  private readonly timedOut = new WeakSet<QueryRunner>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: Logger,
    { queryTimeoutMs }: UnitOfWorkOptions,
  ) {
    this.acquireTimeoutMs = queryTimeoutMs;
    this.lockWaitSeconds = Math.ceil(queryTimeoutMs / 1_000);
  }

  async run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T> {
    const effects: Effect[] = [];
    // Effects run after the runner is released, on success and after a failed COMMIT alike.
    return commitThenEffects(
      () =>
        this.withRunner(async (runner) => {
          // InnoDB's default lock wait is 50 s. Session scope is safe: the next borrower's run()
          // sets it again, and plain reads take no row locks.
          await runner.query(`SET SESSION innodb_lock_wait_timeout = ${this.lockWaitSeconds}`);
          await runner.startTransaction("REPEATABLE READ");
          let value: T;
          try {
            value = await work(this.transactionScope(runner.manager, effects));
          } catch (error) {
            // Nothing was committed, so nothing may be flushed or announced.
            effects.length = 0;
            await this.rollbackQuietly(runner, error);
            throw error;
          }
          try {
            await runner.commitTransaction();
          } catch (error) {
            // TypeORM keeps the transaction flagged after a failed COMMIT: roll back so a
            // connection that is still usable never returns to the pool mid-transaction.
            await this.rollbackQuietly(runner, error);
            throw error;
          }
          return value;
        }),
      () => this.runEffects(effects),
    );
  }

  async readSnapshot<T>(work: (scope: ReadScope) => Promise<T>): Promise<T> {
    return this.withRunner(async (runner) => {
      // T4 §6 requires REPEATABLE READ; set it explicitly rather than trusting the server default.
      // It applies to the next transaction only, so it cannot leak into the pooled connection.
      await runner.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await runner.query("START TRANSACTION READ ONLY");
      try {
        const value = await work(this.readScope(runner.manager));
        await runner.query("COMMIT");
        return value;
      } catch (error) {
        if (!this.noteTimeout(runner, error)) {
          await runner.query("ROLLBACK").catch((rollbackError: unknown) => {
            this.noteTimeout(runner, rollbackError);
            this.logger.warn({ err: rollbackError }, "read-only rollback failed");
          });
        }
        throw error;
      }
    });
  }

  /**
   * Read-only queries only. The transaction was opened with raw SQL, so TypeORM does not know
   * one is active: repositories in a ReadScope must never call methods that start their own
   * transaction (save, remove, manager.transaction), which would implicitly commit this one.
   */
  protected readScope(manager: EntityManager): ReadScope {
    return {
      events: new TypeOrmEventRepository(manager),
      briefings: new TypeOrmBriefingReadRepository(manager),
      outcomes: new TypeOrmOutcomeRepository(manager),
    };
  }

  protected transactionScope(manager: EntityManager, effects: Effect[]): TransactionScope {
    return {
      events: new TypeOrmEventRepository(manager),
      briefings: new TypeOrmBriefingReadRepository(manager),
      generations: new TypeOrmGenerationWriteRepository(manager),
      slots: new TypeOrmPreviewSlotRepository(manager),
      savedBriefings: new TypeOrmSavedBriefingWriteRepository(manager),
      feedback: new TypeOrmFeedbackWriteRepository(manager),
      outcomes: new TypeOrmOutcomeRepository(manager),
      afterCommit: (effect) => {
        effects.push(effect);
      },
    };
  }

  private async withRunner<T>(use: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = await this.acquire();
    try {
      return await use(runner);
    } catch (error) {
      this.noteTimeout(runner, error);
      throw toStoreError(error);
    } finally {
      if (this.timedOut.has(runner)) await discardConnection(runner);
      await runner.release();
    }
  }

  /**
   * Waits at most the query timeout for a pooled connection: mysql2 3.24.5 has no acquire timeout
   * and queues borrowers without limit while every connection is busy.
   */
  private async acquire(): Promise<QueryRunner> {
    let runner: QueryRunner;
    let connecting: Promise<unknown>;
    try {
      runner = this.dataSource.createQueryRunner();
      connecting = runner.connect();
    } catch (error) {
      throw storeUnavailable(error);
    }
    const acquisition = await this.settleWithinDeadline(connecting);
    switch (acquisition.kind) {
      case "connected":
        return runner;
      case "failed":
        await runner.release().catch(() => undefined);
        throw storeUnavailable(acquisition.error);
      case "timed-out":
        // The pool still owes this runner a connection: return it as soon as it arrives.
        void connecting.then(
          () => runner.release(),
          () => undefined,
        );
        throw storeBusy(
          new Error(`No pooled MySQL connection within ${this.acquireTimeoutMs} ms.`),
        );
      default:
        return assertNever(acquisition);
    }
  }

  private async settleWithinDeadline(connecting: Promise<unknown>): Promise<Acquisition> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<Acquisition>((resolve) => {
      timer = setTimeout(() => {
        resolve({ kind: "timed-out" });
      }, this.acquireTimeoutMs);
    });
    try {
      return await Promise.race([
        connecting.then(
          (): Acquisition => ({ kind: "connected" }),
          (error: unknown): Acquisition => ({ kind: "failed", error }),
        ),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Records a query timeout on the runner; nothing more may be sent on its connection. */
  private noteTimeout(runner: QueryRunner, error: unknown): boolean {
    if (!isQueryTimeout(error)) return false;
    this.timedOut.add(runner);
    return true;
  }

  private async rollbackQuietly(runner: QueryRunner, cause: unknown): Promise<void> {
    if (this.noteTimeout(runner, cause) || !runner.isTransactionActive) return;
    await runner.rollbackTransaction().catch((error: unknown) => {
      this.noteTimeout(runner, error);
      this.logger.warn({ err: error }, "rollback failed");
    });
  }

  private async runEffects(effects: readonly Effect[]): Promise<void> {
    for (const effect of effects) {
      try {
        await effect();
      } catch (error) {
        this.logger.error({ err: error }, "after-commit effect failed");
      }
    }
  }
}
