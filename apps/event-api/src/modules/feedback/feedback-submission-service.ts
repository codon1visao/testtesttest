import type { EventId, FeedbackNote } from "@event-desk/contracts";
import type { Clock } from "../../ports/clock.js";
import type { UnitOfWork } from "../../ports/unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import type { Logger } from "../../shared/logger.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import type { BatchScheduler } from "../generation/batch-scheduler.js";
import { checkFeedbackLimits, feedbackIdFor } from "./domain/feedback-limits.js";

export interface SubmitFeedbackCommand {
  eventId: EventId;
  submissionId: string;
  text: string;
}

export interface FeedbackSubmissionResult {
  created: boolean;
  note: FeedbackNote;
  automaticBriefing: "scheduled" | "deferred";
}

export interface FeedbackSubmissionDeps {
  uow: UnitOfWork;
  scheduler: Pick<BatchScheduler, "scheduleOrDefer">;
  clock: Clock;
  changes: Pick<EventChangePublisher, "publish">;
  maxNotesPerEvent: number;
  logger: Logger;
}

/** TX9 (F3, T4): idempotent per submissionId; the batch is scheduled only after the commit. */
export class FeedbackSubmissionService {
  constructor(private readonly deps: FeedbackSubmissionDeps) {}

  async submit(command: SubmitFeedbackCommand): Promise<FeedbackSubmissionResult> {
    const { eventId } = command;
    const saved = await this.deps.uow.run(async (tx) => {
      const aggregate = await tx.events.lockForUpdate(eventId);
      const state = await tx.events.feedbackState(eventId);
      const existing = await tx.feedback.findBySubmissionId(eventId, command.submissionId);
      if (existing !== null)
        return { created: false, note: existing, pending: state.pendingSince !== null };

      const limit = checkFeedbackLimits(
        aggregate.feedback,
        command.text,
        this.deps.maxNotesPerEvent,
      );
      if (!limit.ok) {
        throw new AppError(
          "FEEDBACK_LIMIT_REACHED",
          limit.reason === "count"
            ? `This event already has the maximum of ${String(this.deps.maxNotesPerEvent)} feedback notes.`
            : "This event's feedback has reached its total size limit (32 KiB).",
        );
      }
      const now = this.deps.clock.now();
      const note: FeedbackNote = {
        id: feedbackIdFor(state.nextFeedbackNumber),
        text: command.text,
        receivedAt: now.toISOString(),
      };
      await tx.feedback.insert({
        eventId,
        id: note.id,
        text: command.text,
        submissionId: command.submissionId,
        receivedAt: now,
        displayOrder: state.nextFeedbackNumber,
      });
      await tx.events.recordFeedbackReceived(eventId, now);
      tx.afterCommit(() => {
        this.deps.logger.info({ eventId, noteId: note.id }, "feedback accepted");
        return Promise.resolve();
      });
      tx.afterCommit(() => this.deps.changes.publish(eventId));
      return { created: true, note, pending: true };
    });
    if (!saved.created) {
      this.deps.logger.info({ eventId, noteId: saved.note.id }, "feedback replayed");
    }
    const automaticBriefing = saved.pending
      ? await this.deps.scheduler.scheduleOrDefer(eventId)
      : "scheduled";
    return { created: saved.created, note: saved.note, automaticBriefing };
  }
}
