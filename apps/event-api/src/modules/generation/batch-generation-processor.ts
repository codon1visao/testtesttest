import type { EventId, RunId } from "@event-desk/contracts";
import type {
  BatchJobContext,
  BatchJobHandler,
  BatchStep,
} from "../../ports/briefing-batch-queue.js";
import type { Clock } from "../../ports/clock.js";
import type { GenerationLimits } from "../../ports/generation-limits.js";
import type { Logger } from "../../shared/logger.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import type { BriefingGenerationService } from "./briefing-generation-service.js";
import { BATCH_EXECUTION_DEADLINE_MS } from "./domain/batch-jobs.js";
import {
  attemptDeadline,
  BATCH_ATTEMPT_TIMEOUT_MS,
  nextRetryDelayMs,
} from "./domain/batch-retry-policy.js";
import type { ManualGenerationCoordinator } from "./manual-generation-coordinator.js";

export interface BatchProcessorDeps {
  generation: Pick<
    BriefingGenerationService,
    "generateBatch" | "recordBatchOutcome" | "hasOutcome"
  >;
  manual: Pick<ManualGenerationCoordinator, "whenIdle" | "manualStatus">;
  limits: Pick<GenerationLimits, "cooldownUntil">;
  changes: Pick<EventChangePublisher, "publish">;
  clock: Clock;
  logger: Logger;
  random?: () => number;
  attemptTimeoutMs?: number;
}

const DONE: BatchStep = { kind: "done" };

/**
 * The batch side of T5 §3: decides each execution of a batch job. Generation itself is the shared
 * BriefingGenerationService pipeline; the queue only carries the job and its retry delays.
 */
export class BatchGenerationProcessor implements BatchJobHandler {
  constructor(private readonly deps: BatchProcessorDeps) {}

  async handle(job: BatchJobContext): Promise<BatchStep> {
    const { eventId, runId } = job;
    const { generation } = this.deps;
    if (job.interruptedWhileSending) {
      // The previous execution may have reached the provider: never replay it (F7-11, F8).
      if (!(await generation.hasOutcome(runId))) {
        await generation.recordBatchOutcome(eventId, runId, "failed", "AI_OUTCOME_UNKNOWN");
      }
      return DONE;
    }
    if (await job.hasNewerReadyJob()) {
      await generation.recordBatchOutcome(eventId, runId, "superseded");
      return DONE;
    }
    if (this.deps.manual.manualStatus(eventId) !== null) {
      await job.reportPhase("waiting"); // F7 "Waiting"; then the nothing-new check usually skips (F7-07)
      await this.deps.manual.whenIdle(eventId);
      await job.reportPhase("generating");
    }

    const now = this.deps.clock.now().getTime();
    const executionDeadline = job.firstStartedAt.getTime() + BATCH_EXECUTION_DEADLINE_MS;
    if (now >= executionDeadline) return this.exhausted(eventId, runId);

    const result = await generation.generateBatch({
      eventId,
      runId,
      attempt: job.attempt,
      deadlineAt: attemptDeadline(
        now,
        executionDeadline,
        this.deps.attemptTimeoutMs ?? BATCH_ATTEMPT_TIMEOUT_MS,
      ),
      beforeDispatch: () => job.markSending(),
      afterDispatch: () => job.markSettled(),
    });
    if (result.kind === "finished") return DONE;

    const after = this.deps.clock.now();
    const cooldownEnd = await this.deps.limits.cooldownUntil(eventId, after);
    const delayMs = nextRetryDelayMs({
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }),
      ...(cooldownEnd === null
        ? {}
        : { cooldownRemainingMs: cooldownEnd.getTime() - after.getTime() }),
      now: after.getTime(),
      executionDeadline,
      random: (this.deps.random ?? Math.random)(),
    });
    if (delayMs === null) return this.exhausted(eventId, runId);
    this.deps.logger.info(
      { runId, attempt: job.attempt, code: result.code, delayMs },
      "batch attempt will retry",
    );
    return { kind: "retry", delayMs };
  }

  async abandoned(job: { runId: RunId; eventId: EventId }): Promise<void> {
    if (await this.deps.generation.hasOutcome(job.runId)) return;
    await this.deps.generation.recordBatchOutcome(job.eventId, job.runId, "failed", "INTERNAL");
  }

  stateChanged(eventId: EventId): Promise<void> {
    return this.deps.changes.publish(eventId);
  }

  private async exhausted(eventId: EventId, runId: RunId): Promise<BatchStep> {
    await this.deps.generation.recordBatchOutcome(eventId, runId, "failed", "ATTEMPTS_EXHAUSTED");
    return DONE;
  }
}
