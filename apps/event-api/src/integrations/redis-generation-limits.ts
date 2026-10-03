import type { EventId, GenerationTrigger } from "@event-desk/contracts";
import type { Redis } from "ioredis";
import type { AttemptReservation, GenerationLimits } from "../ports/generation-limits.js";
import type { Logger } from "../shared/logger.js";
import { cooldownKey, usageKey } from "./redis-keys.js";

const USAGE_TTL_MS = 48 * 3_600_000;

// KEYS: total, batch. ARGV: totalLimit, batchLimit, isBatch, ttlMs. Returns 1 when reserved.
const RESERVE = `
local total = tonumber(redis.call('GET', KEYS[1]) or '0')
if total >= tonumber(ARGV[1]) then return 0 end
if ARGV[3] == '1' then
  local batch = tonumber(redis.call('GET', KEYS[2]) or '0')
  if batch >= tonumber(ARGV[2]) then return 0 end
  redis.call('INCR', KEYS[2])
  redis.call('PEXPIRE', KEYS[2], ARGV[4])
end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return 1`;

// KEYS: total, batch. ARGV: isBatch. Never below zero.
const RELEASE = `
if tonumber(redis.call('GET', KEYS[1]) or '0') > 0 then redis.call('DECR', KEYS[1]) end
if ARGV[1] == '1' and tonumber(redis.call('GET', KEYS[2]) or '0') > 0 then redis.call('DECR', KEYS[2]) end
return 1`;

// KEYS: cooldown. ARGV: untilMs, ttlMs. Keeps the later end.
const COOLDOWN = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if tonumber(ARGV[1]) > current then redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) end
return 1`;

const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

/** T5 §5 keys. Every method is atomic in Redis and never throws (fail open, logged). */
export class RedisGenerationLimits implements GenerationLimits {
  constructor(
    private readonly redis: Redis,
    private readonly caps: { dailyAttempts: number; batchDailyAttempts: number },
    private readonly logger: Logger,
  ) {}

  async cooldownUntil(eventId: EventId, now: Date): Promise<Date | null> {
    try {
      const value = Number(await this.redis.get(cooldownKey(eventId)));
      return Number.isFinite(value) && value > now.getTime() ? new Date(value) : null;
    } catch (error) {
      this.logger.warn({ err: error, eventId }, "cooldown read failed; treating as no cooldown");
      return null;
    }
  }

  async startCooldown(eventId: EventId, until: Date, now: Date): Promise<void> {
    const ttlMs = until.getTime() - now.getTime();
    if (ttlMs <= 0) return;
    try {
      await this.redis.eval(
        COOLDOWN,
        1,
        cooldownKey(eventId),
        String(until.getTime()),
        String(ttlMs),
      );
    } catch (error) {
      this.logger.warn({ err: error, eventId }, "cooldown write failed");
    }
  }

  async reserveAttempt(
    eventId: EventId,
    trigger: GenerationTrigger,
    now: Date,
  ): Promise<AttemptReservation> {
    const day = utcDay(now);
    try {
      const reserved = await this.redis.eval(
        RESERVE,
        2,
        usageKey(eventId, day, "total"),
        usageKey(eventId, day, "batch"),
        String(this.caps.dailyAttempts),
        String(this.caps.batchDailyAttempts),
        trigger === "feedback_batch" ? "1" : "0",
        String(USAGE_TTL_MS),
      );
      return reserved === 1 ? { kind: "reserved", day } : { kind: "limit-reached" };
    } catch (error) {
      this.logger.warn(
        { err: error, eventId },
        "budget check failed; allowing the attempt (the Gateway backstop still applies)",
      );
      return { kind: "unavailable" };
    }
  }

  async releaseAttempt(eventId: EventId, trigger: GenerationTrigger, day: string): Promise<void> {
    try {
      await this.redis.eval(
        RELEASE,
        2,
        usageKey(eventId, day, "total"),
        usageKey(eventId, day, "batch"),
        trigger === "feedback_batch" ? "1" : "0",
      );
    } catch (error) {
      this.logger.warn({ err: error, eventId }, "budget release failed");
    }
  }
}
