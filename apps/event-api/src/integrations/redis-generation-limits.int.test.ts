import { SUPPLIED_EVENT } from "@event-desk/contracts";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearApplicationKeys, openTestRedis } from "../testing/redis.js";
import { silentLogger } from "../testing/test-config.js";
import { cooldownKey, usageKey } from "./redis-keys.js";
import { RedisGenerationLimits } from "./redis-generation-limits.js";

const E101 = SUPPLIED_EVENT.id;
const NOW = new Date("2026-10-04T10:00:00.000Z");
let redis: Redis;
let limits: RedisGenerationLimits;

beforeAll(async () => {
  redis = await openTestRedis();
});
afterAll(async () => {
  await clearApplicationKeys(redis);
  redis.disconnect();
});
beforeEach(async () => {
  await clearApplicationKeys(redis);
  limits = new RedisGenerationLimits(
    redis,
    { dailyAttempts: 3, batchDailyAttempts: 2 },
    silentLogger,
  );
});

describe("RedisGenerationLimits (F7 budget, F8 cooldown, T5 §5)", () => {
  it("reserves batch attempts up to the batch cap and manual attempts up to the total", async () => {
    expect(await limits.reserveAttempt(E101, "feedback_batch", NOW)).toEqual({
      kind: "reserved",
      day: "2026-10-04",
    });
    expect(await limits.reserveAttempt(E101, "feedback_batch", NOW)).toMatchObject({
      kind: "reserved",
    });
    expect(await limits.reserveAttempt(E101, "feedback_batch", NOW)).toEqual({
      kind: "limit-reached",
    });
    expect(await limits.reserveAttempt(E101, "manual", NOW)).toMatchObject({ kind: "reserved" });
    expect(await limits.reserveAttempt(E101, "manual", NOW)).toEqual({ kind: "limit-reached" });
    expect(await redis.get(usageKey(E101, "2026-10-04", "total"))).toBe("3");
    expect(await redis.get(usageKey(E101, "2026-10-04", "batch"))).toBe("2");
    const ttl = await redis.pttl(usageKey(E101, "2026-10-04", "total"));
    expect(ttl).toBeGreaterThan(47 * 3_600_000);
  });

  it("counts each UTC day separately", async () => {
    for (let i = 0; i < 3; i++) await limits.reserveAttempt(E101, "manual", NOW);
    expect(
      await limits.reserveAttempt(E101, "manual", new Date("2026-10-05T00:00:00.000Z")),
    ).toEqual({
      kind: "reserved",
      day: "2026-10-05",
    });
  });

  it("releases an attempt that never reached the provider, never below zero", async () => {
    const reservation = await limits.reserveAttempt(E101, "feedback_batch", NOW);
    if (reservation.kind !== "reserved") throw new Error("expected a reservation");
    await limits.releaseAttempt(E101, "feedback_batch", reservation.day);
    await limits.releaseAttempt(E101, "feedback_batch", reservation.day);
    expect(await redis.get(usageKey(E101, "2026-10-04", "total"))).toBe("0");
    expect(await redis.get(usageKey(E101, "2026-10-04", "batch"))).toBe("0");
  });

  it("keeps the later cooldown and expires it with the wait", async () => {
    await limits.startCooldown(E101, new Date(NOW.getTime() + 30_000), NOW);
    await limits.startCooldown(E101, new Date(NOW.getTime() + 10_000), NOW);
    expect(await limits.cooldownUntil(E101, NOW)).toEqual(new Date(NOW.getTime() + 30_000));
    expect(await limits.cooldownUntil(E101, new Date(NOW.getTime() + 31_000))).toBeNull();
    const ttl = await redis.pttl(cooldownKey(E101));
    expect(ttl).toBeGreaterThan(29_000);
    expect(ttl).toBeLessThanOrEqual(30_000);
  });

  it("fails open when Redis is unavailable", async () => {
    const broken = await openTestRedis();
    broken.disconnect();
    const offline = new RedisGenerationLimits(
      broken,
      { dailyAttempts: 3, batchDailyAttempts: 2 },
      silentLogger,
    );
    expect(await offline.reserveAttempt(E101, "manual", NOW)).toEqual({ kind: "unavailable" });
    expect(await offline.cooldownUntil(E101, NOW)).toBeNull();
    await expect(
      offline.startCooldown(E101, new Date(NOW.getTime() + 1_000), NOW),
    ).resolves.toBeUndefined();
  });
});
