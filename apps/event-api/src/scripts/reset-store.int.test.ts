import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Redis } from "ioredis";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapStore } from "../persistence/store-bootstrap.js";
import { openTestDataSource } from "../testing/database.js";
import { openTestRedis } from "../testing/redis.js";
import { silentLogger, testMysqlUrl, testRedisUrl } from "../testing/test-config.js";
import { apiAnswers, probeApi, ResetRefusedError, resetStore } from "./reset-store.js";

let redis: Redis;
let closedPortHealth: string;

async function listen(
  handler: Parameters<typeof createServer>[1],
): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/api/health` };
}

const close = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => {
      resolve();
    });
  });

beforeAll(async () => {
  redis = await openTestRedis();
  // A port that was just free and is now closed: nothing listens there.
  const { server, url } = await listen(() => undefined);
  await close(server);
  closedPortHealth = url;
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
  it("is true while something answers the health URL and false only when the connection is refused", async () => {
    const { server, url } = await listen((_req, res) => res.end("ok"));
    try {
      expect(await apiAnswers(url)).toBe(true);
    } finally {
      await close(server);
    }
    expect(await apiAnswers(closedPortHealth)).toBe(false);
  });

  it("treats a refused connection to localhost (IPv4 and IPv6 attempts) as stopped", async () => {
    const closed = new URL(closedPortHealth);
    expect(await probeApi(`http://localhost:${closed.port}/api/health`)).toBe("stopped");
  });

  it("is true when the API answers with an error status", async () => {
    const { server, url } = await listen((_req, res) => {
      res.statusCode = 500;
      res.end("down");
    });
    try {
      expect(await apiAnswers(url)).toBe(true);
    } finally {
      await close(server);
    }
  });

  it("fails closed: a reply slower than the timeout is still treated as a running API", async () => {
    const { server, url } = await listen(() => undefined); // accepts, never replies
    try {
      expect(await apiAnswers(url, 150)).toBe(true);
      expect(await probeApi(url, 150)).toBe("inconclusive");
    } finally {
      await close(server);
    }
  });
});

describe("resetStore", () => {
  it("refuses while the event API answers, changing nothing", async () => {
    const dataSource = await openTestDataSource();
    await bootstrapStore(dataSource, silentLogger, new Date());
    await redis.set("event-desk:cache:event:E101:ver", "7");
    try {
      const eventsBefore = await dataSource.query<{ n: string }[]>(
        "SELECT COUNT(*) AS n FROM events",
      );
      await expect(
        resetStore({
          mysqlUrl: testMysqlUrl(),
          redisUrl: testRedisUrl(),
          healthUrl: closedPortHealth,
          isApiRunning: () => Promise.resolve(true),
        }),
      ).rejects.toBeInstanceOf(ResetRefusedError);
      expect(await dataSource.query("SELECT COUNT(*) AS n FROM events")).toEqual(eventsBefore);
      expect(Number(eventsBefore[0]?.n)).toBeGreaterThanOrEqual(1);
      expect(await redis.get("event-desk:cache:event:E101:ver")).toBe("7");
    } finally {
      await dataSource.destroy();
    }
  });

  it("refuses when the API probe is inconclusive (a live API that is slow to answer)", async () => {
    const { server, url } = await listen(() => undefined);
    try {
      await expect(
        resetStore({
          mysqlUrl: testMysqlUrl(),
          redisUrl: testRedisUrl(),
          healthUrl: url,
          isApiRunning: (healthUrl) => apiAnswers(healthUrl, 150),
        }),
      ).rejects.toBeInstanceOf(ResetRefusedError);
    } finally {
      await close(server);
    }
  });

  it("aborts with nothing changed when Redis is unreachable", async () => {
    const dataSource = await openTestDataSource();
    await bootstrapStore(dataSource, silentLogger, new Date());
    try {
      const before = await dataSource.query<{ n: string }[]>("SELECT COUNT(*) AS n FROM events");
      await expect(
        resetStore({
          mysqlUrl: testMysqlUrl(),
          redisUrl: "redis://127.0.0.1:1/1",
          healthUrl: closedPortHealth,
        }),
      ).rejects.toThrow(/cannot reach Redis.*Nothing was changed/);
      expect(await dataSource.query("SELECT COUNT(*) AS n FROM events")).toEqual(before);
    } finally {
      await dataSource.destroy();
    }
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
      healthUrl: closedPortHealth,
    });
    expect(report.database).toBe("event_desk_test");
    expect(report.deletedKeys["event-desk:"]).toBeGreaterThanOrEqual(1);
    expect(report.deletedKeys["bull:briefing-batch:"]).toBeGreaterThanOrEqual(1);
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
