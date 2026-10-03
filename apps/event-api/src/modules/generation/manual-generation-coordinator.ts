import type { BriefingView, EventId, RunId } from "@event-desk/contracts";
import type { Clock } from "../../ports/clock.js";
import type { IdGenerator } from "../../ports/id-generator.js";
import type { Logger } from "../../shared/logger.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import type { BriefingGenerationService } from "./briefing-generation-service.js";

export interface ManualGenerationDeps {
  generation: Pick<BriefingGenerationService, "generateManual">;
  ids: IdGenerator;
  clock: Clock;
  changes: Pick<EventChangePublisher, "publish">;
  /** MANUAL_GENERATION_TIMEOUT_MS: the whole run's deadline, passed to the Gateway (F8). */
  timeoutMs: number;
  logger: Logger;
}

interface InFlightRun {
  runId: RunId;
  startedAt: Date;
  result: Promise<BriefingView>;
}

/**
 * Manual generation is synchronous and single-flight per event (T5 §2, F4-07): a second click or
 * tab joins the running call. One event-api process is assumed (T3 §14). Also the live source of
 * `generation.manual` for the event view (through GenerationActivityService).
 */
export class ManualGenerationCoordinator {
  private readonly inFlight = new Map<EventId, InFlightRun>();

  constructor(private readonly deps: ManualGenerationDeps) {}

  generate(eventId: EventId, baseAttendanceRevision: number): Promise<BriefingView> {
    const running = this.inFlight.get(eventId);
    if (running !== undefined) return running.result;

    const runId = this.deps.ids.manualRunId();
    const startedAt = this.deps.clock.now();
    const deadlineAt = new Date(startedAt.getTime() + this.deps.timeoutMs);
    // Deferred by one microtask so the run is registered before its first flush reads it.
    const result = Promise.resolve().then(() =>
      this.run(eventId, runId, deadlineAt, baseAttendanceRevision),
    );
    this.inFlight.set(eventId, { runId, startedAt, result });
    return result;
  }

  /** The event's running manual generation, if any. */
  manualStatus(eventId: EventId): { runId: RunId; startedAt: string } | null {
    const run = this.inFlight.get(eventId);
    return run === undefined ? null : { runId: run.runId, startedAt: run.startedAt.toISOString() };
  }

  /**
   * Settles when the event's manual generation (if any) finishes, after its finish flush; never
   * rejects. A batch waits on it before calling the Gateway (T5 §2, F7 coordinator priority).
   */
  whenIdle(eventId: EventId): Promise<void> {
    const run = this.inFlight.get(eventId);
    return run === undefined
      ? Promise.resolve()
      : run.result.then(
          () => undefined,
          () => undefined,
        );
  }

  /** Every running manual generation (shutdown drain). */
  async whenAllIdle(): Promise<void> {
    await Promise.all([...this.inFlight.keys()].map((eventId) => this.whenIdle(eventId)));
  }

  private async run(
    eventId: EventId,
    runId: RunId,
    deadlineAt: Date,
    baseAttendanceRevision: number,
  ): Promise<BriefingView> {
    try {
      await this.flush(eventId, runId); // other tabs see "Generating briefing…"
      return await this.deps.generation.generateManual({
        eventId,
        runId,
        baseAttendanceRevision,
        deadlineAt,
      });
    } finally {
      this.inFlight.delete(eventId);
      await this.flush(eventId, runId); // and see it finish
    }
  }

  /** A failed flush never replaces the run's real outcome (its preview or its AppError). */
  private async flush(eventId: EventId, runId: RunId): Promise<void> {
    try {
      await this.deps.changes.publish(eventId);
    } catch (error) {
      this.deps.logger.warn({ err: error, eventId, runId }, "manual generation flush failed");
    }
  }
}
