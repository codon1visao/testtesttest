import { type EventId, type EventView, EventViewSchema } from "@event-desk/contracts";
import type { Redis } from "ioredis";
import type { CachedEventView, EventViewCache } from "../ports/event-view-cache.js";
import type { Logger } from "../shared/logger.js";
import { eventViewKey, eventViewVersionKey } from "./redis-keys.js";

export class RedisEventViewCache implements EventViewCache {
  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  async lookup(eventId: EventId): Promise<CachedEventView> {
    const rawVersion = await this.redis.get(eventViewVersionKey(eventId));
    const version = rawVersion === null ? 0 : Number.parseInt(rawVersion, 10);
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new Error(`Cache version key for ${eventId} is not a counter.`);
    }
    const json = await this.redis.get(eventViewKey(eventId, version));
    return { version, view: json === null ? null : this.parse(eventId, json) };
  }

  async store(eventId: EventId, version: number, view: EventView, ttlMs: number): Promise<void> {
    await this.redis.set(eventViewKey(eventId, version), JSON.stringify(view), "PX", ttlMs);
  }

  async invalidate(eventId: EventId): Promise<number> {
    const next = await this.redis.incr(eventViewVersionKey(eventId));
    await this.redis.del(eventViewKey(eventId, next - 1));
    return next;
  }

  private parse(eventId: EventId, json: string): EventView | null {
    try {
      const result = EventViewSchema.safeParse(JSON.parse(json));
      if (result.success) return result.data;
    } catch {
      // fall through: unreadable JSON
    }
    this.logger.warn({ eventId }, "ignoring unreadable cached event view");
    return null;
  }
}
