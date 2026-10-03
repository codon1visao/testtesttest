import type { EventId } from "@event-desk/contracts";
import type { BriefingBatchQueue } from "../../ports/briefing-batch-queue.js";
import type { UnitOfWork } from "../../ports/unit-of-work.js";
import type { Logger } from "../../shared/logger.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";

export interface BatchSchedulerDeps {
  queue: Pick<BriefingBatchQueue, "schedule" | "status">;
  uow: UnitOfWork;
  changes: Pick<EventChangePublisher, "publish">;
  logger: Logger;
}

/** The commit-then-schedule boundary of F7 Durability: MySQL's pending flag is the fallback. */
export class BatchScheduler {
  constructor(private readonly deps: BatchSchedulerDeps) {}

  async scheduleOrDefer(eventId: EventId): Promise<"scheduled" | "deferred"> {
    try {
      await this.deps.queue.schedule(eventId);
    } catch (error) {
      this.deps.logger.warn(
        { err: error, eventId },
        "automatic briefing deferred: the batch queue is unavailable",
      );
      return "deferred";
    }
    await this.deps.changes.publish(eventId); // the view now shows "collecting"
    return "scheduled";
  }

  async reconcile(): Promise<void> {
    let eventIds: EventId[];
    try {
      eventIds = await this.deps.uow.readSnapshot((scope) =>
        scope.events.pendingFeedbackEventIds(),
      );
    } catch (error) {
      this.deps.logger.warn({ err: error }, "pending feedback could not be read at startup");
      return;
    }
    for (const eventId of eventIds) {
      try {
        if ((await this.deps.queue.status(eventId)) === null) await this.scheduleOrDefer(eventId);
      } catch (error) {
        this.deps.logger.warn(
          { err: error, eventId },
          "pending feedback could not be re-scheduled",
        );
      }
    }
  }
}
