import { SUPPLIED_EVENT } from "@event-desk/contracts";
import type { Server } from "node:http";
import type { Redis } from "ioredis";
import type { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { composeEventApi, type EventApi } from "../compose.js";
import { uuidV7IdGenerator } from "../integrations/uuid-v7-id-generator.js";
import { openTestDataSource, truncateAllTables } from "../testing/database.js";
import { clearApplicationKeys, openTestRedis } from "../testing/redis.js";
import { integrationConfig, silentLogger } from "../testing/test-config.js";
import { runSimulation } from "./feedback-simulation.js";

let dataSource: DataSource;
let redis: Redis;
let api: EventApi;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  dataSource = await openTestDataSource();
  redis = await openTestRedis();
});
afterAll(async () => {
  await clearApplicationKeys(redis);
  redis.disconnect();
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await clearApplicationKeys(redis);
  api = await composeEventApi(integrationConfig({ batchWindowMs: 60_000 }), {
    logger: silentLogger,
  });
  server = api.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("no address");
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});
afterEach(async () => {
  api.stopStreams();
  await new Promise((resolve) => server.close(resolve));
  await api.close();
});

describe("runSimulation (F3 script)", () => {
  it("posts each note once through the real endpoint and reports the server's IDs", async () => {
    const results = await runSimulation(
      {
        count: 3,
        intervalMs: 0,
        texts: ["A.", "B."],
        apiUrl: baseUrl,
        origin: "http://localhost:5173",
        eventId: SUPPLIED_EVENT.id,
      },
      { fetch, sleep: () => Promise.resolve(), newSubmissionId: () => uuidV7IdGenerator.itemId() },
    );
    expect(results).toEqual([
      { id: "F09", automaticBriefing: "scheduled" },
      { id: "F10", automaticBriefing: "scheduled" },
      { id: "F11", automaticBriefing: "scheduled" },
    ]);
    const texts = await dataSource.query<{ text: string }[]>(
      "SELECT text FROM feedback_notes WHERE origin = 'submitted' ORDER BY display_order",
    );
    expect(texts.map((row) => row.text)).toEqual(["A.", "B.", "A."]);
  });

  it("stops with a clear error when the API rejects a note", async () => {
    await expect(
      runSimulation(
        {
          count: 1,
          intervalMs: 0,
          texts: ["A."],
          apiUrl: baseUrl,
          origin: "https://evil.example",
          eventId: SUPPLIED_EVENT.id,
        },
        {
          fetch,
          sleep: () => Promise.resolve(),
          newSubmissionId: () => uuidV7IdGenerator.itemId(),
        },
      ),
    ).rejects.toThrow(/403/);
  });
});
