import { AdvancedConsoleLogger, DataSource } from "typeorm";
import { ENTITIES } from "./entities/index.js";
import { InitialSchema1790985600000 } from "./migrations/1790985600000-initial-schema.js";

export const MYSQL_POOL_SIZE = 10;

export interface DataSourceOptions {
  /** mysql2's per-query `timeout`: a query that has not answered by then rejects. */
  queryTimeoutMs: number;
}

/**
 * TypeORM's console logger reports every query slower than `maxQueryExecutionTime` with its SQL
 * and parameters, whatever `logging` says. Those can carry feedback text (S1), so slow queries
 * are not logged here; the timeout surfaces as a typed error instead.
 */
class QuietSlowQueryLogger extends AdvancedConsoleLogger {
  override logQuerySlow(): void {
    // Intentionally silent.
  }
}

/** MySQL 8.4 through TypeORM: UTC DATETIME(3), hand-written migrations, never synchronize (T4 §1). */
export function createDataSource(
  mysqlUrl: string,
  { queryTimeoutMs }: DataSourceOptions,
): DataSource {
  return new DataSource({
    type: "mysql",
    url: mysqlUrl,
    timezone: "Z",
    charset: "utf8mb4_0900_ai_ci",
    connectTimeout: 2_000,
    poolSize: MYSQL_POOL_SIZE,
    // TypeORM 1.1.1 passes `timeout: maxQueryExecutionTime` to every mysql2 query when both are
    // set. mysql2 3.24.5 rejects with PROTOCOL_SEQUENCE_TIMEOUT but keeps the connection busy with
    // the query; callers discard such connections (pooled-connection.ts). mysql2 has no pool
    // `acquireTimeout` (TypeORM forwards it, mysql2 ignores it with a console warning), so waiting
    // for a pooled connection is bounded by the unit of work instead.
    enableQueryTimeout: true,
    maxQueryExecutionTime: queryTimeoutMs,
    entities: ENTITIES,
    migrations: [InitialSchema1790985600000],
    migrationsTableName: "schema_migrations",
    migrationsTransactionMode: "none",
    synchronize: false,
    logging: false,
    logger: new QuietSlowQueryLogger(false),
  });
}
