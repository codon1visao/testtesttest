import type { DataSource } from "typeorm";
import { createDataSource } from "../persistence/data-source.js";
import { SCHEMA_TABLES_CHILD_FIRST } from "../persistence/migrations/1790985600000-initial-schema.js";
import { testMysqlUrl } from "./test-config.js";

export const APPLICATION_TABLES = SCHEMA_TABLES_CHILD_FIRST;

export async function openTestDataSource(): Promise<DataSource> {
  const dataSource = createDataSource(testMysqlUrl());
  await dataSource.initialize();
  return dataSource;
}

/** Empties every application table on one connection (FOREIGN_KEY_CHECKS is per session). */
export async function truncateAllTables(dataSource: DataSource): Promise<void> {
  const runner = dataSource.createQueryRunner();
  try {
    await runner.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const table of APPLICATION_TABLES) await runner.query(`TRUNCATE TABLE \`${table}\``);
    } finally {
      await runner.query("SET FOREIGN_KEY_CHECKS = 1");
    }
  } finally {
    await runner.release();
  }
}
