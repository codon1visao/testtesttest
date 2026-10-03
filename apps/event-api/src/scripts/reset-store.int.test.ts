import { createServer, type Server } from "node:http";
import type { Redis } from "ioredis";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapStore } from "../persistence/store-bootstrap.js";
import { openTestDataSource } from "../testing/database.js";
import { openTestRedis } from "../testing/redis.js";
import { silentLogger, testMysqlUrl, testRedisUrl } from "../testing/test-config.js";
import { apiAnswers, ResetRefusedError, resetStore } from "./reset-store.js";

const CLOSED_PORT_HEALTH = "http://127.0.0.1:4999/api/health";
let redis: Redis;

beforeAll(async () => {
  redis = await openTestRedis();
});
afterAll(async () => {
  await redis.del("other:keep");
  redis.disconnect();
  // Leave event_desk_test migrated and seeded for any test file that runs after this one.
  const dataSource = await openTestDataSource();
  await bootstrapStore(dataSource, silentLogger, new Date());
  await dataSource.destroy();
});

describe("apiAnswers", () => {
  it("is true while something answers the health URL and false on a closed port", async () => {
    const server: Server = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server has no port");
    try {
      expect(await apiAnswers(`http://127.0.0.1:${address.port}/api/health`)).toBe(true);
    } finally {
      server.close();
    }
    expect(await apiAnswers(CLOSED_PORT_HEALTH)).toBe(false);
  });
});

describe("resetStore", () => {
  it("refuses while the event API answers", async () => {
    await expect(
      resetStore({
        mysqlUrl: testMysqlUrl(),
        redisUrl: testRedisUrl(),
        healthUrl: CLOSED_PORT_HEALTH,
        isApiRunning: () => Promise.resolve(true),
      }),
    ).rejects.toBeInstanceOf(ResetRefusedError);
  });

  it("F1-07: drops and recreates the database, deletes only application keys, and the next start reseeds", async () => {
    let dataSource: DataSource = await openTestDataSource();
    await bootstrapStore(dataSource, silentLogger, new Date());
    await dataSource.query("UPDATE members SET attendance = 'attended' WHERE id = 'M03'");
    await dataSource.destroy();
    await redis.set("event-desk:cache:event:E101:ver", "4");
    await redis.set("bull:briefing-batch:1", "job");
    await redis.set("other:keep", "1");

    const report = await resetStore({
      mysqlUrl: testMysqlUrl(),
      redisUrl: testRedisUrl(),
      healthUrl: CLOSED_PORT_HEALTH,
    });
    expect(report.database).toBe("event_desk_test");
    expect(report.deletedKeys["event-desk:"]).toBeGreaterThanOrEqual(1);
    expect(report.deletedKeys["bull:briefing-batch:"]).toBe(1);
    expect(await redis.exists("other:keep")).toBe(1);

    dataSource = await openTestDataSource();
    try {
      const tables = await dataSource.query<unknown[]>(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'event_desk_test'",
      );
      expect(tables).toHaveLength(0);
      await bootstrapStore(dataSource, silentLogger, new Date());
      const [chris] = await dataSource.query<{ attendance: string }[]>(
        "SELECT attendance FROM members WHERE id = 'M03'",
      );
      expect(chris?.attendance).toBe("not_recorded");
    } finally {
      await dataSource.destroy();
    }
  });
});
