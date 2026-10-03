import { EventIdSchema } from "@event-desk/contracts";
import { buildSeedEventView } from "@event-desk/contracts/testing";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearApplicationKeys, openTestRedis } from "../testing/redis.js";
import { silentLogger } from "../testing/test-config.js";
import { RedisEventViewCache } from "./redis-event-view-cache.js";
import { eventViewKey, eventViewVersionKey } from "./redis-keys.js";

const E101 = EventIdSchema.parse("E101");
const view = buildSeedEventView();
let redis: Redis;
let cache: RedisEventViewCache;

beforeAll(async () => {
  redis = await openTestRedis();
  cache = new RedisEventViewCache(redis, silentLogger);
});
afterAll(async () => {
  await clearApplicationKeys(redis);
  redis.disconnect();
});
beforeEach(async () => {
  await clearApplicationKeys(redis);
});

describe("RedisEventViewCache", () => {
  it("misses at version 0 on an empty cache", async () => {
    expect(await cache.lookup(E101)).toEqual({ version: 0, view: null });
  });

  it("stores and returns the view at the observed version, with a TTL", async () => {
    await cache.store(E101, 0, view, 30_000);
    expect(await cache.lookup(E101)).toEqual({ version: 0, view });
    const ttl = await redis.pttl(eventViewKey(E101, 0));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30_000);
  });

  it("invalidates by bumping the version and deleting the old entry", async () => {
    await cache.store(E101, 0, view, 30_000);
    expect(await cache.invalidate(E101)).toBe(1);
    expect(await redis.get(eventViewVersionKey(E101))).toBe("1");
    expect(await redis.exists(eventViewKey(E101, 0))).toBe(0);
    expect(await cache.lookup(E101)).toEqual({ version: 1, view: null });
  });

  it("closes the read/flush race: a late store lands on a retired version (T3 §7)", async () => {
    const before = await cache.lookup(E101);
    await cache.invalidate(E101);
    await cache.store(E101, before.version, view, 30_000);
    expect((await cache.lookup(E101)).view).toBeNull();
  });

  it("treats an unreadable cached entry as a miss", async () => {
    await redis.set(eventViewKey(E101, 0), "{not json", "PX", 30_000);
    expect(await cache.lookup(E101)).toEqual({ version: 0, view: null });
    await redis.set(eventViewKey(E101, 0), JSON.stringify({ event: "wrong shape" }), "PX", 30_000);
    expect(await cache.lookup(E101)).toEqual({ version: 0, view: null });
  });
});
