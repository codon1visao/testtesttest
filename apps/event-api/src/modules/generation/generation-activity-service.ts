import type { EventId } from "@event-desk/contracts";
import type { BriefingBatchQueue } from "../../ports/briefing-batch-queue.js";
import type { Clock } from "../../ports/clock.js";
import type {
  GenerationActivity,
  GenerationActivitySnapshot,
} from "../../ports/generation-activity.js";
import type { GenerationLimits } from "../../ports/generation-limits.js";
import type { Logger } from "../../shared/logger.js";
import type { ManualGenerationCoordinator } from "./manual-generation-coordinator.js";

export interface GenerationActivityDeps {
  manual: Pick<ManualGenerationCoordinator, "manualStatus">;
  queue: Pick<BriefingBatchQueue, "status">;
  limits: Pick<GenerationLimits, "cooldownUntil">;
  clock: Clock;
  logger: Logger;
}

/** Live generation state that is not in MySQL (T3 §5 GenerationStatusView): manual run, batch job, cooldown. */
export class GenerationActivityService implements GenerationActivity {
  constructor(private readonly deps: GenerationActivityDeps) {}

  async current(eventId: EventId): Promise<GenerationActivitySnapshot> {
    const [batch, cooldownUntil] = await Promise.all([
      this.batchStatus(eventId),
      // The limits never throw: a store error reads as no cooldown (fail open).
      this.deps.limits.cooldownUntil(eventId, this.deps.clock.now()),
    ]);
    return {
      manual: this.deps.manual.manualStatus(eventId),
      batch: batch.status,
      batchKnown: batch.known,
      cooldownUntil,
    };
  }

  private async batchStatus(
    eventId: EventId,
  ): Promise<{ status: GenerationActivitySnapshot["batch"]; known: boolean }> {
    try {
      return { status: await this.deps.queue.status(eventId), known: true };
    } catch (error) {
      // The view still answers without the queue store: the batch line is simply not shown.
      this.deps.logger.warn({ err: error, eventId }, "batch status unavailable; showing none");
      return { status: null, known: false };
    }
  }
}
