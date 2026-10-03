import type { BriefingView, EventId, RunId } from "@event-desk/contracts";
import type { Clock } from "../../ports/clock.js";
import type {
  GenerationActivity,
  GenerationActivitySnapshot,
} from "../../ports/generation-activity.js";
import type { IdGenerator } from "../../ports/id-generator.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import type { BriefingGenerationService } from "./briefing-generation-service.js";

export interface ManualGenerationDeps {
  generation: Pick<BriefingGenerationService, "generateManual">;
  ids: IdGenerator;
  clock: Clock;
  changes: Pick<EventChangePublisher, "publish">;
  /** MANUAL_GENERATION_TIMEOUT_MS: the whole run's deadline, passed to the Gateway (F8). */
  timeoutMs: number;
}

interface InFlightRun {
  runId: RunId;
  startedAt: Date;
  result: Promise<BriefingView>;
}

/**
 * Manual generation is synchronous and single-flight per event (T5 §2, F4-07): a second click or
 * tab joins the running call. One event-api process is assumed (T3 §14). Also the live source of
 * `generation.manual` for the event view.
 */
export class ManualGenerationCoordinator implements GenerationActivity {
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

  current(eventId: EventId): Promise<GenerationActivitySnapshot> {
    const run = this.inFlight.get(eventId);
    return Promise.resolve({
      manual:
        run === undefined ? null : { runId: run.runId, startedAt: run.startedAt.toISOString() },
      batch: null,
      cooldownUntil: null,
    });
  }

  private async run(
    eventId: EventId,
    runId: RunId,
    deadlineAt: Date,
    baseAttendanceRevision: number,
  ): Promise<BriefingView> {
    try {
      await this.deps.changes.publish(eventId); // other tabs see "Generating briefing…"
      return await this.deps.generation.generateManual({
        eventId,
        runId,
        baseAttendanceRevision,
        deadlineAt,
      });
    } finally {
      this.inFlight.delete(eventId);
      await this.deps.changes.publish(eventId); // and see it finish
    }
  }
}
