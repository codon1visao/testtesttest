import {
  EventIdSchema,
  type EventView,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import { buildSeedEventView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import type { CachedEventView, EventViewCache } from "../../ports/event-view-cache.js";
import type { GenerationActivity } from "../../ports/generation-activity.js";
import type { ReadScope, TransactionScope, UnitOfWork } from "../../ports/unit-of-work.js";
import { createLogger } from "../../shared/logger.js";
import { CacheBypass } from "../changes/cache-bypass.js";
import { EventViewService } from "./event-view-service.js";

const E101 = SUPPLIED_EVENT.id;
const NOW = new Date("2026-10-03T09:00:00.000Z");
const idleActivity: GenerationActivity = {
  current: () => Promise.resolve({ manual: null, batch: null, cooldownUntil: null }),
};

class FakeUnitOfWork implements UnitOfWork {
  snapshots = 0;
  /** Runs inside the snapshot, as a concurrent writer or a failed flush would. */
  duringSnapshot: () => void = () => undefined;
  readonly scope: ReadScope = {
    events: {
      findAggregate: (eventId) =>
        Promise.resolve(
          eventId === E101
            ? {
                event: SUPPLIED_EVENT,
                attendanceRevision: 0,
                briefingRevision: 0,
                members: [...SUPPLIED_MEMBERS],
                feedback: SUPPLIED_FEEDBACK.map((n) => ({ ...n, receivedAt: FIXTURE_TIME })),
              }
            : null,
        ),
      pendingFeedbackEventIds: () => Promise.resolve([]),
    },
    briefings: {
      loadSlots: () => Promise.resolve({ saved: null, selected: null, incoming: null }),
    },
    outcomes: { latest: () => Promise.resolve(null), statusOf: () => Promise.resolve(null) },
  };
  run<T>(_work: (tx: TransactionScope) => Promise<T>): Promise<T> {
    return Promise.reject(new Error("the event read never writes"));
  }
  readSnapshot<T>(work: (scope: ReadScope) => Promise<T>): Promise<T> {
    this.snapshots += 1;
    this.duringSnapshot();
    return work(this.scope);
  }
}

class FakeCache implements EventViewCache {
  version = 7;
  cached: EventView | null = null;
  lookupError: Error | null = null;
  storeError: Error | null = null;
  stored: { version: number; ttlMs: number }[] = [];
  lookup(): Promise<CachedEventView> {
    return this.lookupError
      ? Promise.reject(this.lookupError)
      : Promise.resolve({ version: this.version, view: this.cached });
  }
  store(_eventId: unknown, version: number, _view: EventView, ttlMs: number): Promise<void> {
    if (this.storeError) return Promise.reject(this.storeError);
    this.stored.push({ version, ttlMs });
    return Promise.resolve();
  }
  invalidate(): Promise<number> {
    this.version += 1;
    return Promise.resolve(this.version);
  }
}

function setup(defaultTtlMs = 30_000) {
  const uow = new FakeUnitOfWork();
  const cache = new FakeCache();
  const bypass = new CacheBypass();
  const service = new EventViewService({
    uow,
    cache,
    bypass,
    activity: idleActivity,
    clock: { now: () => NOW },
    defaultTtlMs,
    logger: createLogger("silent"),
  });
  return { uow, cache, bypass, service };
}

describe("EventViewService", () => {
  it("builds the view on a miss and caches it at the version read before the database read", async () => {
    const { uow, cache, service } = setup();
    // A write commits and flushes while the snapshot is read: the version moves on to 8.
    uow.duringSnapshot = () => void cache.invalidate();
    const view = await service.get(E101);
    expect(view.counts).toEqual({ registered: 4, attended: 1, absent: 2, notRecorded: 1 });
    expect(view.generation).toEqual({
      manual: null,
      batch: null,
      lastOutcome: null,
      cooldownUntil: null,
    });
    expect(view.savedBriefing).toBeNull();
    expect(uow.snapshots).toBe(1);
    // Stored under the retired version 7, so the possibly stale view is never served.
    expect(cache.version).toBe(8);
    expect(cache.stored).toEqual([{ version: 7, ttlMs: 30_000 }]);
  });

  it("does not store a view built while a failed flush switched reads to MySQL", async () => {
    const { uow, cache, bypass, service } = setup();
    uow.duringSnapshot = () => {
      bypass.activate();
    };
    await expect(service.get(E101)).resolves.toMatchObject({ event: SUPPLIED_EVENT });
    expect(uow.snapshots).toBe(1);
    expect(cache.stored).toEqual([]);
  });

  it("serves a cache hit without touching MySQL", async () => {
    const { uow, cache, service } = setup();
    cache.cached = buildSeedEventView({ attendanceRevision: 3 });
    expect((await service.get(E101)).attendanceRevision).toBe(3);
    expect(uow.snapshots).toBe(0);
  });

  it("skips the cache entirely while the bypass is active", async () => {
    const { uow, cache, bypass, service } = setup();
    bypass.activate();
    cache.cached = buildSeedEventView({ attendanceRevision: 3 });
    expect((await service.get(E101)).attendanceRevision).toBe(0);
    expect(uow.snapshots).toBe(1);
    expect(cache.stored).toEqual([]);
  });

  it("reads MySQL when the cache read fails, and does not store", async () => {
    const { uow, cache, service } = setup();
    cache.lookupError = new Error("ECONNREFUSED");
    await service.get(E101);
    expect(uow.snapshots).toBe(1);
    expect(cache.stored).toEqual([]);
  });

  it("still answers when storing fails", async () => {
    const { cache, service } = setup();
    cache.storeError = new Error("ECONNRESET");
    await expect(service.get(E101)).resolves.toMatchObject({ event: SUPPLIED_EVENT });
  });

  it("does not cache when the TTL is 0", async () => {
    const { cache, service } = setup(0);
    await service.get(E101);
    expect(cache.stored).toEqual([]);
  });

  it("answers an unknown event with EVENT_NOT_FOUND and caches nothing", async () => {
    const { cache, service } = setup();
    await expect(service.get(EventIdSchema.parse("E999"))).rejects.toMatchObject({
      code: "EVENT_NOT_FOUND",
    });
    expect(cache.stored).toEqual([]);
  });
});
