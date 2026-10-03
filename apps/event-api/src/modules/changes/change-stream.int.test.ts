import { SUPPLIED_EVENT } from "@event-desk/contracts";
import { get, type IncomingMessage, type Server } from "node:http";
import type { Redis } from "ioredis";
import request from "supertest";
import type { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { composeEventApi, type EventApi } from "../../compose.js";
import { uuidV7IdGenerator } from "../../integrations/uuid-v7-id-generator.js";
import { openTestDataSource, truncateAllTables } from "../../testing/database.js";
import { clearApplicationKeys, openTestRedis } from "../../testing/redis.js";
import { integrationConfig, silentLogger } from "../../testing/test-config.js";

const E101 = SUPPLIED_EVENT.id;
let dataSource: DataSource;
let redis: Redis;
let api: EventApi;
let server: Server;
let port: number;

function listeningPort(listening: Server): number {
  const address = listening.address();
  if (typeof address !== "object" || address === null) throw new Error("server is not on TCP");
  return address.port;
}

function openStream(path: string): Promise<{ response: IncomingMessage; chunks: string[] }> {
  return new Promise((resolve, reject) => {
    const req = get(
      { host: "127.0.0.1", port, path, headers: { Accept: "text/event-stream" } },
      (response) => {
        const chunks: string[] = [];
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => chunks.push(chunk));
        resolve({ response, chunks });
      },
    );
    req.on("error", reject);
  });
}

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
  port = listeningPort(server);
});
afterEach(async () => {
  api.stopStreams();
  await new Promise((resolve) => server.close(resolve));
  await api.close();
});

describe("GET /api/events/:eventId/changes (F7, T3 §5)", () => {
  it("F7-15: a note saved elsewhere reaches an open stream as a changed message", async () => {
    const { response, chunks } = await openStream(`/api/events/${E101}/changes`);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(response.headers["cache-control"]).toBe("no-store");
    await request(api.app)
      .post(`/api/events/${E101}/feedback`)
      .set("Origin", "http://localhost:5173")
      .send({ submissionId: uuidV7IdGenerator.itemId(), text: "Live." })
      .expect(201);
    await vi.waitFor(() => {
      expect(chunks.join("")).toMatch(/event: changed\ndata: \{"version":\d+\}\n\n/);
    });
    expect(chunks.join("")).toMatch(/^retry: 3000\n\n/);
    response.destroy();
  });

  it("answers 404 for an unknown event instead of opening a stream", async () => {
    const { response } = await openStream("/api/events/E999/changes");
    expect(response.statusCode).toBe(404);
    response.resume();
  });

  it("stopStreams ends open streams so the server can close", async () => {
    const { response } = await openStream(`/api/events/${E101}/changes`);
    const ended = new Promise((resolve) => response.on("end", resolve));
    api.stopStreams();
    await ended;
  });
});
