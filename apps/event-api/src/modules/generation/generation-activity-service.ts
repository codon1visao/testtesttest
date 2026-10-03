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
    let batch: GenerationActivitySnapshot["batch"] = null;
    try {
      batch = await this.deps.queue.status(eventId);
    } catch (error) {
      // The view still answers without the queue store: the batch line is simply not shown.
      this.deps.logger.warn({ err: error, eventId }, "batch status unavailable; showing none");
    }
    return {
      manual: this.deps.manual.manualStatus(eventId),
      batch,
      // The limits never throw: a store error reads as no cooldown (fail open).
      cooldownUntil: await this.deps.limits.cooldownUntil(eventId, this.deps.clock.now()),
    };
  }
}
