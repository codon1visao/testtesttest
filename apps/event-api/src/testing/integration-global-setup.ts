import { createConnection } from "mysql2/promise";
import { createDataSource } from "../persistence/data-source.js";
import { integrationConfig, testMysqlUrl } from "./test-config.js";

/** Recreates event_desk_test once per integration run and applies the migrations. */
export default async function setup(): Promise<void> {
  const url = new URL(testMysqlUrl());
  const database = decodeURIComponent(url.pathname.slice(1));
  if (database !== "event_desk_test") {
    throw new Error(`Integration tests only run against event_desk_test (got "${database}").`);
  }
  const server = new URL(url);
  server.pathname = "/";
  const connection = await createConnection(server.toString());
  try {
    await connection.query("DROP DATABASE IF EXISTS `event_desk_test`");
    await connection.query(
      "CREATE DATABASE `event_desk_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci",
    );
  } finally {
    await connection.end();
  }
  const dataSource = createDataSource(url.toString(), {
    queryTimeoutMs: integrationConfig().mysqlQueryTimeoutMs,
  });
  await dataSource.initialize();
  try {
    await dataSource.runMigrations({ transaction: "none" });
  } finally {
    await dataSource.destroy();
  }
}
