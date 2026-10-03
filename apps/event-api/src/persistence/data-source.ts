import { DataSource } from "typeorm";
import { ENTITIES } from "./entities/index.js";
import { InitialSchema1790985600000 } from "./migrations/1790985600000-initial-schema.js";

/** MySQL 8.4 through TypeORM: UTC DATETIME(3), hand-written migrations, never synchronize (T4 §1). */
export function createDataSource(mysqlUrl: string): DataSource {
  return new DataSource({
    type: "mysql",
    url: mysqlUrl,
    timezone: "Z",
    charset: "utf8mb4_0900_ai_ci",
    connectTimeout: 2_000,
    poolSize: 10,
    entities: ENTITIES,
    migrations: [InitialSchema1790985600000],
    migrationsTableName: "schema_migrations",
    migrationsTransactionMode: "none",
    synchronize: false,
    logging: false,
  });
}
