import { deriveAttendanceCounts, type EventId, type EventView } from "@event-desk/contracts";
import type { Clock } from "../../ports/clock.js";
import type { CachedEventView, EventViewCache } from "../../ports/event-view-cache.js";
import type { GenerationActivity } from "../../ports/generation-activity.js";
import type { UnitOfWork } from "../../ports/unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import type { Logger } from "../../shared/logger.js";
import { loadBriefingViews } from "../briefing/briefing-views.js";
import type { CacheBypass } from "../changes/cache-bypass.js";
import { toBatchStatusView } from "../generation/domain/batch-jobs.js";
import { cacheTtlMs } from "./domain/cache-ttl.js";

export interface EventViewServiceDeps {
  uow: UnitOfWork;
  cache: EventViewCache;
  bypass: CacheBypass;
  activity: GenerationActivity;
  clock: Clock;
  defaultTtlMs: number;
  logger: Logger;
}

/** GET /api/events/:id — cache first, MySQL snapshot on a miss; freshness computed while building (T3 §7). */
export class EventViewService {
  constructor(private readonly deps: EventViewServiceDeps) {}

  async get(eventId: EventId): Promise<EventView> {
    const cached = await this.lookup(eventId);
    if (cached?.view) return cached.view;
    const view = await this.build(eventId);
    if (cached !== null) await this.store(eventId, cached.version, view);
    return view;
  }

  private async lookup(eventId: EventId): Promise<CachedEventView | null> {
    if (this.deps.bypass.active) return null;
    try {
      return await this.deps.cache.lookup(eventId);
    } catch (error) {
      this.deps.logger.warn(
        { err: error, eventId },
        "event view cache read failed; reading from MySQL",
      );
      return null;
    }
  }

  private async store(eventId: EventId, version: number, view: EventView): Promise<void> {
    if (this.deps.bypass.active) return;
    const ttlMs = cacheTtlMs(view, this.deps.clock.now(), this.deps.defaultTtlMs);
    if (ttlMs <= 0) return;
    try {
      await this.deps.cache.store(eventId, version, view, ttlMs);
    } catch (error) {
      this.deps.logger.warn({ err: error, eventId }, "event view cache write failed");
    }
  }

  private async build(eventId: EventId): Promise<EventView> {
    const snapshot = await this.deps.uow.readSnapshot(async (scope) => {
      const aggregate = await scope.events.findAggregate(eventId);
      if (aggregate === null)
        throw new AppError("EVENT_NOT_FOUND", `Event ${eventId} was not found.`);
      const briefings = await loadBriefingViews(
        scope,
        eventId,
        aggregate.members,
        aggregate.feedback,
      );
      const lastOutcome = await scope.outcomes.latest(eventId);
      const { pendingSince } = await scope.events.feedbackState(eventId);
      return { aggregate, briefings, lastOutcome, pendingSince };
    });
    const activity = await this.deps.activity.current(eventId);
    const { aggregate, briefings, lastOutcome, pendingSince } = snapshot;
    return {
      event: aggregate.event,
      members: aggregate.members,
      feedback: aggregate.feedback,
      counts: deriveAttendanceCounts(aggregate.members),
      attendanceRevision: aggregate.attendanceRevision,
      briefingRevision: aggregate.briefingRevision,
      ...briefings,
      generation: {
        manual: activity.manual,
        batch: toBatchStatusView(activity.batch, aggregate.feedback, pendingSince),
        cooldownUntil: activity.cooldownUntil?.toISOString() ?? null,
        lastOutcome,
      },
    };
  }
}
