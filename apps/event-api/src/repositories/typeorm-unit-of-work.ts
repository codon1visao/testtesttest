import type { DataSource, EntityManager, QueryRunner } from "typeorm";
import type { ReadScope, TransactionScope, UnitOfWork } from "../ports/unit-of-work.js";
import type { Logger } from "../shared/logger.js";
import { TypeOrmEventRepository } from "./event-repository.js";
import { storeUnavailable, toStoreError } from "./store-errors.js";

type Effect = () => Promise<void>;

/** InnoDB REPEATABLE READ transactions on one pooled connection; side effects only after COMMIT (T4 §6–7). */
export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: Logger,
  ) {}

  async run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T> {
    const effects: Effect[] = [];
    const result = await this.withRunner(async (runner) => {
      await runner.startTransaction("REPEATABLE READ");
      try {
        const value = await work(this.transactionScope(runner.manager, effects));
        await runner.commitTransaction();
        return value;
      } catch (error) {
        await this.rollbackQuietly(runner);
        throw error;
      }
    });
    await this.runEffects(effects);
    return result;
  }

  async readSnapshot<T>(work: (scope: ReadScope) => Promise<T>): Promise<T> {
    return this.withRunner(async (runner) => {
      await runner.query("START TRANSACTION READ ONLY");
      try {
        const value = await work(this.readScope(runner.manager));
        await runner.query("COMMIT");
        return value;
      } catch (error) {
        await runner.query("ROLLBACK").catch((rollbackError: unknown) => {
          this.logger.warn({ err: rollbackError }, "read-only rollback failed");
        });
        throw error;
      }
    });
  }

  protected readScope(manager: EntityManager): ReadScope {
    return { events: new TypeOrmEventRepository(manager) };
  }

  protected transactionScope(manager: EntityManager, effects: Effect[]): TransactionScope {
    return {
      events: new TypeOrmEventRepository(manager),
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
      throw toStoreError(error);
    } finally {
      await runner.release();
    }
  }

  private async acquire(): Promise<QueryRunner> {
    let runner: QueryRunner | undefined;
    try {
      runner = this.dataSource.createQueryRunner();
      await runner.connect();
      return runner;
    } catch (error) {
      await runner?.release().catch(() => undefined);
      throw storeUnavailable(error);
    }
  }

  private async rollbackQuietly(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) return;
    await runner.rollbackTransaction().catch((error: unknown) => {
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
