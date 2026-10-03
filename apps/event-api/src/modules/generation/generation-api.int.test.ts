import {
  EventViewSchema,
  GenerateBriefingResponseSchema,
  SUPPLIED_EVENT,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import type { Redis } from "ioredis";
import request from "supertest";
import type { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { composeEventApi, type EventApi } from "../../compose.js";
import { cooldownKey, usageKey } from "../../integrations/redis-keys.js";
import { openTestDataSource, truncateAllTables } from "../../testing/database.js";
import { type FakeGateway, startFakeGateway } from "../../testing/fake-gateway.js";
import { errorCodeOf } from "../../testing/http.js";
import { clearApplicationKeys, openTestRedis } from "../../testing/redis.js";
import { insertGenerationFixture, putPreviewSlot } from "../../testing/sql-fixtures.js";
import { integrationConfig, silentLogger } from "../../testing/test-config.js";

const E101 = SUPPLIED_EVENT.id;
const ORIGIN = "http://localhost:5173";
const SECRET = integrationConfig().gateway.secret;
let dataSource: DataSource;
let redis: Redis;
let gateway: FakeGateway;
let api: EventApi;

const generate = (base = 0, origin = ORIGIN) =>
  request(api.app)
    .post(`/api/events/${E101}/briefing-generations`)
    .set("Origin", origin)
    .send({ baseAttendanceRevision: base });
const view = async () =>
  EventViewSchema.parse((await request(api.app).get(`/api/events/${E101}`)).body);
const count = async (sql: string) => Number((await dataSource.query<{ n: number }[]>(sql))[0]?.n);

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
  gateway = await startFakeGateway(SECRET);
  api = await composeEventApi(
    integrationConfig({ gateway: { host: "127.0.0.1", port: gateway.port, secret: SECRET } }),
    { logger: silentLogger },
  );
});
afterEach(async () => {
  await api.close();
  await gateway.close();
});

describe("POST /api/events/:eventId/briefing-generations", () => {
  it("F4-01/F4-10: generates synchronously into the incoming slot and the next read shows it", async () => {
    const res = await generate();
    expect(res.status).toBe(201);
    const { incomingPreview } = GenerateBriefingResponseSchema.parse(res.body);
    expect(incomingPreview.trigger).toBe("manual");
    expect(gateway.requests).toHaveLength(1);
    const after = await view();
    expect(after.incomingPreview).toEqual(incomingPreview);
    expect(after.generation.manual).toBeNull();
    expect(after.generation.lastOutcome).toMatchObject({ trigger: "manual", status: "succeeded" });
  });

  it("Review Focus 1 / F4-07: two concurrent requests share one Gateway call", async () => {
    gateway.enqueue({ kind: "hold" });
    const first = generate();
    const second = generate();
    const responses = Promise.all([first, second]);
    await vi.waitFor(() => {
      expect(gateway.requests).toHaveLength(1);
    });
    expect((await view()).generation.manual).not.toBeNull(); // another tab sees "Generating briefing…"
    gateway.release();
    const [a, b] = await responses;
    expect([a.status, b.status]).toEqual([201, 201]);
    const generationId = GenerateBriefingResponseSchema.parse(a.body).incomingPreview.provenance
      .generationId;
    expect(
      GenerateBriefingResponseSchema.parse(b.body).incomingPreview.provenance.generationId,
    ).toBe(generationId);
    expect(gateway.requests).toHaveLength(1);
    // The view above was cached while the call was held; the flushes after the run must replace
    // it (the coordinator's unit test pins the finish flush's order on its own).
    const after = await view();
    expect(after.generation.manual).toBeNull();
    expect(after.incomingPreview?.provenance.generationId).toBe(generationId);
  });

  it("Review Focus 2 / F4-08: a candidate stays tied to the attendance it read; the save is not blocked", async () => {
    gateway.enqueue({ kind: "hold" });
    const pending = Promise.resolve(generate()); // supertest sends only once something awaits it
    await vi.waitFor(() => {
      expect(gateway.requests).toHaveLength(1);
    });
    const roster = SUPPLIED_MEMBERS.map((m) => ({
      id: m.id,
      attendance: m.id === "M03" ? "attended" : m.attendance,
    }));
    const save = await request(api.app)
      .put(`/api/events/${E101}/attendance`)
      .set("Origin", ORIGIN)
      .send({ baseAttendanceRevision: 0, members: roster });
    expect(save.status).toBe(200);
    gateway.release();
    const { incomingPreview } = GenerateBriefingResponseSchema.parse((await pending).body);
    expect(incomingPreview.freshness.current).toBe(false);
    expect(incomingPreview.freshness.attendanceChanges).toEqual([
      { memberId: "M03", from: "not_recorded", to: "attended" },
    ]);
  });

  it("Review Focus 3 / F4-17: an abandoned request still commits, with no second call", async () => {
    gateway.enqueue({ kind: "hold" });
    // Settled into a value at once, so the timeout cannot become an unhandled rejection.
    const abandoned = generate()
      .timeout(300)
      .then(
        () => null,
        (error: unknown) => error,
      );
    await vi.waitFor(() => {
      expect(gateway.requests).toHaveLength(1);
    });
    expect(String(await abandoned)).toMatch(/timeout/i);
    gateway.release();
    await vi.waitFor(async () => {
      expect(await count("SELECT COUNT(*) AS n FROM preview_slots WHERE slot = 'incoming'")).toBe(
        1,
      );
    });
    expect((await view()).incomingPreview?.trigger).toBe("manual");
    expect(gateway.requests).toHaveLength(1);
  });

  it("Review Focus 4 / F4-04 / F4-12: an invalid candidate is never stored", async () => {
    gateway.enqueue({
      kind: "result",
      sections: {
        feedbackSummary: { text: "Summary.", sourceIds: ["F01"] },
        themes: [{ text: "Rest breaks.", sourceIds: ["F05"] }],
        conflicts: [],
        suggestions: [],
      },
    });
    const res = await generate();
    expect([res.status, errorCodeOf(res)]).toEqual([502, "OUTPUT_INVALID"]);
    expect(await count("SELECT COUNT(*) AS n FROM briefing_generations")).toBe(0);
    expect((await view()).generation.lastOutcome).toMatchObject({
      status: "failed",
      code: "OUTPUT_INVALID",
    });
  });

  it("Review Focus 5 / F8-07: a dropped connection is 504 AI_OUTCOME_UNKNOWN and keeps the existing preview", async () => {
    const existing = await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", existing);
    gateway.enqueue({ kind: "drop" });
    const res = await generate();
    expect([res.status, errorCodeOf(res)]).toEqual([504, "AI_OUTCOME_UNKNOWN"]);
    expect((await view()).incomingPreview?.provenance.generationId).toBe(existing);
  });

  it("F8-06: an unreachable Gateway is an immediate 503 GATEWAY_UNAVAILABLE", async () => {
    await gateway.close();
    const res = await generate();
    expect([res.status, errorCodeOf(res)]).toEqual([503, "GATEWAY_UNAVAILABLE"]);
    expect((await view()).generation.lastOutcome).toMatchObject({
      status: "failed",
      code: "GATEWAY_UNAVAILABLE",
    });
  });

  it("F8-09: a provider rate limit is 429 PROVIDER_COOLDOWN with the wait", async () => {
    gateway.enqueue({
      kind: "error",
      code: "PROVIDER_RATE_LIMITED",
      notSent: false,
      retryAfterMs: 2_000,
    });
    const res = await generate();
    expect([res.status, errorCodeOf(res)]).toEqual([429, "PROVIDER_COOLDOWN"]);
    expect(res.headers["retry-after"]).toBe("2");
    expect(res.body).toMatchObject({ error: { retryAfterMs: 2_000 } });
  });

  it("checks the attendance baseline before any paid call", async () => {
    const res = await generate(5);
    expect([res.status, errorCodeOf(res)]).toEqual([409, "ATTENDANCE_CONFLICT"]);
    expect(gateway.requests).toHaveLength(0);
  });

  it("S1-09: a cross-origin request never reaches the Gateway", async () => {
    const res = await generate(0, "http://evil.example");
    expect([res.status, errorCodeOf(res)]).toEqual([403, "ORIGIN_REJECTED"]);
    expect(gateway.requests).toHaveLength(0);
  });

  it("rejects a body with anything but the attendance baseline", async () => {
    const res = await request(api.app)
      .post(`/api/events/${E101}/briefing-generations`)
      .set("Origin", ORIGIN)
      .send({ baseAttendanceRevision: 0, prompt: "write a poem" });
    expect([res.status, errorCodeOf(res)]).toEqual([400, "VALIDATION_FAILED"]);
    expect(gateway.requests).toHaveLength(0);
  });
});

describe("persisted cooldown and daily budget (F4 step 2, F7, F8-09)", () => {
  it("a rate limit starts a cooldown that blocks the next Generate before any paid call, across a restart", async () => {
    gateway.enqueue({
      kind: "error",
      code: "PROVIDER_RATE_LIMITED",
      notSent: true,
      retryAfterMs: 30_000,
    });
    expect(errorCodeOf(await generate())).toBe("PROVIDER_COOLDOWN");
    expect(await redis.pttl(cooldownKey(E101))).toBeGreaterThan(25_000);
    await api.close();
    api = await composeEventApi(
      integrationConfig({ gateway: { host: "127.0.0.1", port: gateway.port, secret: SECRET } }),
      { logger: silentLogger },
    );
    const blocked = await generate();
    expect([blocked.status, errorCodeOf(blocked)]).toEqual([429, "PROVIDER_COOLDOWN"]);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(20);
    expect(gateway.requests).toHaveLength(1);
  });

  it("the daily total stops manual Generate with 429 DAILY_LIMIT_REACHED and no Gateway call", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await redis.set(usageKey(E101, day, "total"), "20");
    const res = await generate();
    expect([res.status, errorCodeOf(res)]).toEqual([429, "DAILY_LIMIT_REACHED"]);
    expect(gateway.requests).toHaveLength(0);
  });

  it("an attempt the provider never received does not use the budget", async () => {
    gateway.enqueue({ kind: "error", code: "GATEWAY_UNAVAILABLE", notSent: true });
    await generate();
    const day = new Date().toISOString().slice(0, 10);
    expect(await redis.get(usageKey(E101, day, "total"))).toBe("0");
    await generate(); // the default fake reply succeeds
    expect(await redis.get(usageKey(E101, day, "total"))).toBe("1");
  });
});
