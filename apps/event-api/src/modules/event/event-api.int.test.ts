import {
  EventViewSchema,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import type { Redis } from "ioredis";
import request from "supertest";
import type { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { composeEventApi, type EventApi } from "../../compose.js";
import { eventViewKey } from "../../integrations/redis-keys.js";
import { openTestDataSource, truncateAllTables } from "../../testing/database.js";
import { errorCodeOf } from "../../testing/http.js";
import { clearApplicationKeys, openTestRedis } from "../../testing/redis.js";
import {
  GENERATION_FIXTURE_ID,
  insertGenerationFixture,
  putPreviewSlot,
} from "../../testing/sql-fixtures.js";
import { integrationConfig, silentLogger } from "../../testing/test-config.js";

const E101 = SUPPLIED_EVENT.id;
let dataSource: DataSource;
let redis: Redis;
let api: EventApi;

const getEvent = (app = api.app) => request(app).get(`/api/events/${E101}`);

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
  api = await composeEventApi(integrationConfig(), { logger: silentLogger });
});
afterEach(async () => {
  await api.close();
});

describe("GET /api/events/:eventId", () => {
  it("F1-01 / F3-01: returns the seeded event, roster, exact notes and derived counts", async () => {
    const res = await getEvent();
    expect(res.status).toBe(200);
    expect(res.get("Cache-Control")).toBe("no-store");
    const view = EventViewSchema.parse(res.body);
    expect(view.event).toEqual(SUPPLIED_EVENT);
    expect(view.members).toEqual(SUPPLIED_MEMBERS);
    expect(view.feedback.map((n) => [n.id, n.text])).toEqual(
      SUPPLIED_FEEDBACK.map((n) => [n.id, n.text]),
    );
    expect(view.counts).toEqual({ registered: 4, attended: 1, absent: 2, notRecorded: 1 });
    expect([view.savedBriefing, view.selectedPreview, view.incomingPreview]).toEqual([
      null,
      null,
      null,
    ]);
    expect(view.generation).toEqual({
      manual: null,
      batch: null,
      lastOutcome: null,
      cooldownUntil: null,
    });
  });

  it.each(["E999", "e101", "E101%20", "%00"])(
    "F1-08: answers %s with EVENT_NOT_FOUND",
    async (id) => {
      const res = await request(api.app).get(`/api/events/${id}`);
      expect(res.status).toBe(404);
      expect(errorCodeOf(res)).toBe("EVENT_NOT_FOUND");
    },
  );

  it("serves later reads from the cache until a change is published (T3 §7)", async () => {
    await getEvent();
    expect(await redis.exists(eventViewKey(E101, 0))).toBe(1);
    await dataSource.query("UPDATE members SET attendance = 'attended' WHERE id = 'M03'");
    expect(EventViewSchema.parse((await getEvent()).body).counts.attended).toBe(1);
    await api.changes.publish(E101);
    expect(EventViewSchema.parse((await getEvent()).body).counts.attended).toBe(2);
  });

  it("includes stored briefings with freshness computed from saved records", async () => {
    await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", GENERATION_FIXTURE_ID);
    await api.changes.publish(E101);
    const current = EventViewSchema.parse((await getEvent()).body);
    expect(current.incomingPreview?.freshness.current).toBe(true);
    await dataSource.query("UPDATE members SET attendance = 'attended' WHERE id = 'M03'");
    await api.changes.publish(E101);
    const stale = EventViewSchema.parse((await getEvent()).body);
    expect(stale.incomingPreview?.freshness).toEqual({
      current: false,
      attendanceChanges: [{ memberId: "M03", from: "not_recorded", to: "attended" }],
      newFeedbackIds: [],
    });
  });
});

describe("degraded stores", () => {
  it("serves from MySQL quickly when Redis is unreachable, and reports it", async () => {
    const offline = await composeEventApi(
      integrationConfig({ redisUrl: "redis://127.0.0.1:6390/1" }),
      { logger: silentLogger },
    );
    try {
      const started = Date.now();
      const res = await getEvent(offline.app);
      expect(res.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(2_000);
      const health = await request(offline.app).get("/api/health");
      expect(health.body).toEqual({ mysql: "up", redis: "down" });
    } finally {
      await offline.close();
    }
  });

  it("answers 503 STORE_UNAVAILABLE without internals once MySQL is gone", async () => {
    const doomed = await composeEventApi(integrationConfig(), { logger: silentLogger });
    await doomed.close();
    const res = await getEvent(doomed.app);
    expect(res.status).toBe(503);
    expect(errorCodeOf(res)).toBe("STORE_UNAVAILABLE");
    expect(JSON.stringify(res.body)).not.toMatch(/stack|SELECT|mysql:\/\//i);
  });

  it("fails startup clearly, without seeding, when MySQL is unreachable", async () => {
    await expect(
      composeEventApi(
        integrationConfig({ mysqlUrl: "mysql://event_desk:x@127.0.0.1:3399/event_desk_test" }),
        {
          logger: silentLogger,
        },
      ),
    ).rejects.toThrow();
  });

  it("F1-04: a second start against the same store neither duplicates nor resets data", async () => {
    await dataSource.query("UPDATE members SET attendance = 'attended' WHERE id = 'M03'");
    const second = await composeEventApi(integrationConfig(), { logger: silentLogger });
    try {
      const [counts] = await dataSource.query<{ events: number; members: number; notes: number }[]>(
        "SELECT (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM members) AS members, (SELECT COUNT(*) FROM feedback_notes) AS notes",
      );
      expect([Number(counts?.events), Number(counts?.members), Number(counts?.notes)]).toEqual([
        1, 4, 8,
      ]);
      await second.changes.publish(E101);
      expect(EventViewSchema.parse((await getEvent(second.app)).body).counts.attended).toBe(2);
    } finally {
      await second.close();
    }
  });

  it("reports health of both stores", async () => {
    expect((await request(api.app).get("/api/health")).body).toEqual({
      mysql: "up",
      redis: "up",
    });
  });
});
