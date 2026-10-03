import {
  EventViewSchema,
  SaveAttendanceResponseSchema,
  SUPPLIED_EVENT,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import type { Redis } from "ioredis";
import request from "supertest";
import type { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { composeEventApi, type EventApi } from "../../compose.js";
import { eventViewVersionKey } from "../../integrations/redis-keys.js";
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
type Status = "attended" | "absent" | "not_recorded";
const roster = (overrides: Record<string, Status> = {}) =>
  SUPPLIED_MEMBERS.map((m) => ({ id: m.id, attendance: overrides[m.id] ?? m.attendance }));

let dataSource: DataSource;
let redis: Redis;
let api: EventApi;

const save = (body: object, app = api.app) =>
  request(app)
    .put(`/api/events/${E101}/attendance`)
    .set("Origin", "http://localhost:5173")
    .send(body);
const statuses = async () =>
  (
    await dataSource.query<{ id: string; attendance: string }[]>(
      "SELECT id, attendance FROM members ORDER BY display_order",
    )
  ).map((r) => `${r.id}:${r.attendance}`);
const revision = async () =>
  Number(
    (await dataSource.query<{ r: number }[]>("SELECT attendance_revision AS r FROM events"))[0]?.r,
  );

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

describe("PUT /api/events/:eventId/attendance", () => {
  it("F2-02/F2-03: saves the spec example and returns derived counts and the new revision", async () => {
    const res = await save({ baseAttendanceRevision: 0, members: roster({ M03: "attended" }) });
    expect(res.status).toBe(200);
    const body = SaveAttendanceResponseSchema.parse(res.body);
    expect(body.counts).toEqual({ registered: 4, attended: 2, absent: 2, notRecorded: 0 });
    expect(body.attendanceRevision).toBe(1);
    expect(body.freshness).toEqual({
      savedBriefing: null,
      selectedPreview: null,
      incomingPreview: null,
    });
    expect(await statuses()).toEqual(["M01:attended", "M02:absent", "M03:attended", "M04:absent"]);
  });

  it("F1-02: the save survives a backend restart", async () => {
    await save({ baseAttendanceRevision: 0, members: roster({ M03: "attended" }) });
    await api.close();
    api = await composeEventApi(integrationConfig(), { logger: silentLogger });
    const view = EventViewSchema.parse((await request(api.app).get(`/api/events/${E101}`)).body);
    expect(view.counts).toEqual({ registered: 4, attended: 2, absent: 2, notRecorded: 0 });
    expect(view.attendanceRevision).toBe(1);
  });

  it("F2-04: all Not recorded stays distinct from Absent", async () => {
    const all = {
      M01: "not_recorded",
      M02: "not_recorded",
      M03: "not_recorded",
      M04: "not_recorded",
    } as const;
    const body = SaveAttendanceResponseSchema.parse(
      (await save({ baseAttendanceRevision: 0, members: roster(all) })).body,
    );
    expect(body.counts).toEqual({ registered: 4, attended: 0, absent: 0, notRecorded: 4 });
  });

  it("F2-06: an unchanged save keeps the revision and does not flush the cache", async () => {
    await request(api.app).get(`/api/events/${E101}`);
    const res = await save({ baseAttendanceRevision: 0, members: roster().toReversed() });
    expect(res.status).toBe(200);
    expect(SaveAttendanceResponseSchema.parse(res.body).attendanceRevision).toBe(0);
    expect(await redis.get(eventViewVersionKey(E101))).toBeNull();
    expect(await revision()).toBe(0);
  });

  it("refreshes the cached event view after a real change", async () => {
    await request(api.app).get(`/api/events/${E101}`);
    await save({ baseAttendanceRevision: 0, members: roster({ M03: "attended" }) });
    const view = EventViewSchema.parse((await request(api.app).get(`/api/events/${E101}`)).body);
    expect(view.members.find((m) => m.id === "M03")?.attendance).toBe("attended");
  });

  it.each([
    [
      "an unknown state",
      {
        baseAttendanceRevision: 0,
        members: roster().map((m, i) => (i === 0 ? { ...m, attendance: "late" } : m)),
      },
    ],
    ["a duplicate member", { baseAttendanceRevision: 0, members: [...roster(), roster()[0]] }],
    ["a missing member", { baseAttendanceRevision: 0, members: roster().slice(1) }],
    [
      "an unknown member",
      {
        baseAttendanceRevision: 0,
        members: [...roster().slice(1), { id: "M09", attendance: "attended" }],
      },
    ],
    [
      "client-supplied counts",
      { baseAttendanceRevision: 0, members: roster(), counts: { registered: 4 } },
    ],
    ["a negative revision", { baseAttendanceRevision: -1, members: roster() }],
  ])("F2-05: rejects %s with 400 and writes nothing", async (_label, body) => {
    const res = await save(body);
    expect(res.status).toBe(400);
    expect(errorCodeOf(res)).toBe("VALIDATION_FAILED");
    expect(await statuses()).toEqual([
      "M01:attended",
      "M02:absent",
      "M03:not_recorded",
      "M04:absent",
    ]);
    expect(await revision()).toBe(0);
  });

  it("rejects a stale base revision with ATTENDANCE_CONFLICT", async () => {
    await save({ baseAttendanceRevision: 0, members: roster({ M03: "attended" }) });
    const stale = await save({ baseAttendanceRevision: 0, members: roster({ M04: "attended" }) });
    expect(stale.status).toBe(409);
    expect(errorCodeOf(stale)).toBe("ATTENDANCE_CONFLICT");
    expect(await statuses()).toEqual(["M01:attended", "M02:absent", "M03:attended", "M04:absent"]);
  });

  it("T4-04: two concurrent saves from the same revision: one wins, one conflicts, no partial rows", async () => {
    const [a, b] = await Promise.all([
      save({ baseAttendanceRevision: 0, members: roster({ M03: "attended" }) }),
      save({ baseAttendanceRevision: 0, members: roster({ M04: "attended", M02: "attended" }) }),
    ]);
    expect([a.status, b.status].toSorted()).toEqual([200, 409]);
    const winner = SaveAttendanceResponseSchema.parse((a.status === 200 ? a : b).body);
    expect(await statuses()).toEqual(winner.members.map((m) => `${m.id}:${m.attendance}`));
    expect(await revision()).toBe(1);
  });

  it("F2-07 / T4-07: a swap makes an existing briefing stale; swapping back makes it current", async () => {
    await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", GENERATION_FIXTURE_ID);
    const swapped = SaveAttendanceResponseSchema.parse(
      (
        await save({
          baseAttendanceRevision: 0,
          members: roster({ M01: "absent", M02: "attended" }),
        })
      ).body,
    );
    expect(swapped.counts).toEqual({ registered: 4, attended: 1, absent: 2, notRecorded: 1 });
    expect(swapped.freshness.incomingPreview?.current).toBe(false);
    expect(swapped.freshness.incomingPreview?.attendanceChanges.map((c) => c.memberId)).toEqual([
      "M01",
      "M02",
    ]);
    const reverted = SaveAttendanceResponseSchema.parse(
      (await save({ baseAttendanceRevision: 1, members: roster() })).body,
    );
    expect(reverted.freshness.incomingPreview?.current).toBe(true);
  });

  it("S1-09: a cross-origin save is rejected and writes nothing", async () => {
    const res = await request(api.app)
      .put(`/api/events/${E101}/attendance`)
      .set("Origin", "http://evil.example")
      .send({ baseAttendanceRevision: 0, members: roster({ M03: "attended" }) });
    expect(res.status).toBe(403);
    expect(await statuses()).toEqual([
      "M01:attended",
      "M02:absent",
      "M03:not_recorded",
      "M04:absent",
    ]);
  });

  it("answers an unknown event with 404", async () => {
    const res = await request(api.app)
      .put("/api/events/E999/attendance")
      .send({ baseAttendanceRevision: 0, members: roster() });
    expect(res.status).toBe(404);
  });
});
