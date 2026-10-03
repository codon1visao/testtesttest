import {
  type BriefingView,
  buildGeneratedSectionsSchema,
  deriveAttendanceCounts,
  type ErrorCode,
  type EventId,
  type EvidenceSections,
  type FeedbackId,
  type GenerationTrigger,
  feedbackDigest,
  type MemberAttendance,
  type RunId,
  validateEvidenceSections,
} from "@event-desk/contracts";
import type {
  BriefingGenerateV1Input,
  BriefingGenerateV1Result,
  GatewayErrorCode,
} from "@event-desk/contracts/gateway-rpc";
import type {
  AiGatewayClient,
  BriefingCallRequest,
  BriefingCallResult,
} from "../../ports/ai-gateway-client.js";
import type { Clock } from "../../ports/clock.js";
import type { AttemptReservation, GenerationLimits } from "../../ports/generation-limits.js";
import type { IdGenerator } from "../../ports/id-generator.js";
import type {
  EventAggregate,
  OutcomeResult,
  RunOutcomeStatus,
  UnitOfWork,
} from "../../ports/unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import type { Logger } from "../../shared/logger.js";
import { type BriefingViews, loadBriefingViews } from "../briefing/briefing-views.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import { buildAttendanceOverview } from "./domain/attendance-overview.js";
import { isRetryableGatewayFailure } from "./domain/batch-retry-policy.js";
import { toGenerationItems } from "./domain/generation-items.js";
import { decideIncoming } from "./domain/incoming-slot-rules.js";
import { sameInput } from "./domain/same-input.js";
import {
  cooldownError,
  dailyLimitError,
  DEFAULT_COOLDOWN_MS,
  gatewayFailureError,
} from "./gateway-failure.js";

export interface BriefingGenerationDeps {
  uow: UnitOfWork;
  gateway: AiGatewayClient;
  ids: IdGenerator;
  clock: Clock;
  changes: Pick<EventChangePublisher, "publish">;
  logger: Logger;
  limits: GenerationLimits;
}

export interface ManualGenerateCommand {
  eventId: EventId;
  runId: RunId;
  baseAttendanceRevision: number;
  deadlineAt: Date;
}

export interface BatchGenerateCommand {
  eventId: EventId;
  runId: RunId;
  /** 1-based attempt number within the run; the Gateway's attemptId. */
  attempt: number;
  deadlineAt: Date;
  /** Persisted before the Gateway write, and cleared after its result is known (T5 §3). */
  beforeDispatch: () => Promise<void>;
  afterDispatch: () => Promise<void>;
}

export type BatchAttemptResult =
  /** An outcome row was recorded. */
  | { kind: "finished"; status: RunOutcomeStatus }
  /** Nothing recorded; the caller decides whether another attempt fits (F7 retries). */
  | { kind: "retryable"; code: GatewayErrorCode; retryAfterMs?: number };

/** What TX4 / TX10 read: the generation's immutable input. */
interface CapturedInput {
  capturedAt: Date;
  attendance: MemberAttendance[];
  feedbackIds: FeedbackId[];
  feedbackDigest: string;
  input: BriefingGenerateV1Input;
}

/** A run's identity as the shared steps need it. */
interface RunRef {
  eventId: EventId;
  runId: RunId;
  trigger: GenerationTrigger;
}

/**
 * The one generation path for manual and batch runs (T5 §1): capture saved input, call the
 * Gateway with no transaction open, validate against the captured snapshot, commit with the
 * incoming-slot rules. Manual runs are never retried here; batch attempts report whether a
 * failure may be retried and leave the decision to the batch processor.
 */
export class BriefingGenerationService {
  constructor(private readonly deps: BriefingGenerationDeps) {}

  async generateManual(command: ManualGenerateCommand): Promise<BriefingView> {
    const started = Date.now();
    const run: RunRef = { eventId: command.eventId, runId: command.runId, trigger: "manual" };
    const captured = await this.captureForManual(command);
    const now = this.deps.clock.now();
    const cooldownEnd = await this.deps.limits.cooldownUntil(command.eventId, now);
    if (cooldownEnd !== null) throw cooldownError(cooldownEnd.getTime() - now.getTime());
    const reservation = await this.deps.limits.reserveAttempt(command.eventId, "manual", now);
    if (reservation.kind === "limit-reached") throw dailyLimitError();
    const call = await this.dispatch({
      runId: command.runId,
      attemptId: "1",
      lane: "interactive",
      deadlineAt: command.deadlineAt,
      input: captured.input,
    });
    if (!call.ok) {
      await this.settleFailedCall(command.eventId, "manual", reservation, call);
      throw await this.failManual(run, gatewayFailureError(call));
    }
    if (this.deps.clock.now().getTime() > command.deadlineAt.getTime()) {
      throw await this.failManual(
        run,
        gatewayFailureError({ ok: false, code: "DEADLINE_EXCEEDED", notSent: false }),
      );
    }
    const sections = this.validate(call.result, captured.feedbackIds);
    if (sections === null) {
      throw await this.failManual(
        run,
        gatewayFailureError({ ok: false, code: "OUTPUT_INVALID", notSent: false }),
      );
    }

    let preview: BriefingView;
    try {
      const committed = await this.commit(run, captured, call.result, sections);
      if (committed.views.incomingPreview === null) {
        throw new AppError("INTERNAL", "The generated briefing is missing after its commit.");
      }
      preview = committed.views.incomingPreview;
    } catch (error) {
      this.deps.logger.error(
        { err: error, runId: command.runId },
        "generated briefing could not be stored",
      );
      throw await this.failManual(
        run,
        new AppError(
          "RESULT_PERSIST_FAILED",
          "The briefing was generated but could not be saved, so the attempt was charged. Your saved work is unchanged.",
          { cause: error },
        ),
      );
    }
    this.deps.logger.info(
      {
        runId: command.runId,
        generationId: preview.provenance.generationId,
        model: call.result.model,
        promptVersion: call.result.promptVersion,
        usage: call.result.usage,
        durationMs: Date.now() - started,
      },
      "briefing generated",
    );
    return preview;
  }

  /**
   * One attempt of an automatic run (T5 §1, F7 rules 4–6). Never throws for a Gateway failure:
   * a retryable one is returned unrecorded, any other ends the run with a recorded outcome.
   */
  async generateBatch(command: BatchGenerateCommand): Promise<BatchAttemptResult> {
    const started = Date.now();
    const run: RunRef = {
      eventId: command.eventId,
      runId: command.runId,
      trigger: "feedback_batch",
    };
    const finish = async (result: OutcomeResult): Promise<BatchAttemptResult> => {
      await this.recordOutcome(run, result);
      return { kind: "finished", status: result.status };
    };
    const fail = (code: ErrorCode) => finish({ status: "failed", errorCode: code });

    const captured = await this.captureForBatch(command.eventId);
    if (captured.unchanged) return finish({ status: "skipped", errorCode: null });

    const now = this.deps.clock.now();
    const cooldownEnd = await this.deps.limits.cooldownUntil(command.eventId, now);
    if (cooldownEnd !== null) {
      return {
        kind: "retryable",
        code: "PROVIDER_RATE_LIMITED",
        retryAfterMs: cooldownEnd.getTime() - now.getTime(),
      };
    }
    const reservation = await this.deps.limits.reserveAttempt(
      command.eventId,
      "feedback_batch",
      now,
    );
    if (reservation.kind === "limit-reached") return fail("DAILY_LIMIT_REACHED");

    try {
      await command.beforeDispatch();
    } catch (error) {
      // Nothing was sent: give the attempt back before the caller sees the failure.
      if (reservation.kind === "reserved") {
        await this.deps.limits.releaseAttempt(command.eventId, "feedback_batch", reservation.day);
      }
      throw error;
    }
    const call = await this.dispatch({
      runId: command.runId,
      attemptId: String(command.attempt),
      lane: "background",
      deadlineAt: command.deadlineAt,
      input: captured.input,
    });
    await command.afterDispatch();

    if (!call.ok) {
      await this.settleFailedCall(command.eventId, "feedback_batch", reservation, call);
      if (isRetryableGatewayFailure(call.code, call.notSent)) {
        return {
          kind: "retryable",
          code: call.code,
          ...(call.retryAfterMs === undefined ? {} : { retryAfterMs: call.retryAfterMs }),
        };
      }
      return fail(call.code);
    }
    // F8: a late result is discarded, never committed.
    if (this.deps.clock.now().getTime() > command.deadlineAt.getTime()) {
      return fail("DEADLINE_EXCEEDED");
    }
    const sections = this.validate(call.result, captured.feedbackIds);
    if (sections === null) return fail("OUTPUT_INVALID");
    let status: RunOutcomeStatus;
    try {
      status = (await this.commit(run, captured, call.result, sections)).status;
    } catch (error) {
      this.deps.logger.error(
        { err: error, runId: command.runId },
        "generated batch briefing could not be stored",
      );
      return fail("RESULT_PERSIST_FAILED");
    }
    this.deps.logger.info(
      {
        runId: command.runId,
        attempt: command.attempt,
        status,
        model: call.result.model,
        promptVersion: call.result.promptVersion,
        usage: call.result.usage,
        durationMs: Date.now() - started,
      },
      "automatic briefing generated",
    );
    return { kind: "finished", status };
  }

  /** The batch processor's own terminal outcomes: a superseded job, or an exhausted / lost run. */
  recordBatchOutcome(
    eventId: EventId,
    runId: RunId,
    ...outcome: [status: "superseded"] | [status: "failed", code: ErrorCode]
  ): Promise<void> {
    const result: OutcomeResult =
      outcome[0] === "failed"
        ? { status: "failed", errorCode: outcome[1] }
        : { status: outcome[0], errorCode: null };
    return this.recordOutcome({ eventId, runId, trigger: "feedback_batch" }, result);
  }

  /** Whether the run already finished (has an outcome row). */
  hasOutcome(runId: RunId): Promise<boolean> {
    return this.deps.uow.readSnapshot(
      async (scope) => (await scope.outcomes.statusOf(runId)) !== null,
    );
  }

  /** Exactly one Gateway attempt (the client never throws for a Gateway failure). */
  private async dispatch(request: BriefingCallRequest): Promise<BriefingCallResult> {
    const call = await this.deps.gateway.generateBriefing(request);
    if (!call.ok && call.code === "GATEWAY_AUTH_FAILED") {
      this.deps.logger.error(
        { runId: request.runId },
        "GATEWAY_SERVICE_SECRET differs between event API and Gateway",
      );
    }
    return call;
  }

  /** Budget and cooldown bookkeeping after a failed attempt (F8): only an unsent attempt is free. */
  private async settleFailedCall(
    eventId: EventId,
    trigger: GenerationTrigger,
    reservation: AttemptReservation,
    failure: Extract<BriefingCallResult, { ok: false }>,
  ): Promise<void> {
    if (failure.notSent && reservation.kind === "reserved") {
      await this.deps.limits.releaseAttempt(eventId, trigger, reservation.day);
    }
    if (failure.code === "PROVIDER_RATE_LIMITED") {
      const now = this.deps.clock.now();
      await this.deps.limits.startCooldown(
        eventId,
        new Date(now.getTime() + (failure.retryAfterMs ?? DEFAULT_COOLDOWN_MS)),
        now,
      );
    }
  }

  /** TX4: a consistent read-only snapshot; the revision check happens before any paid call. */
  private captureForManual(command: ManualGenerateCommand): Promise<CapturedInput> {
    return this.deps.uow.readSnapshot(async (scope) => {
      const aggregate = await scope.events.findAggregate(command.eventId);
      if (aggregate === null) {
        throw new AppError("EVENT_NOT_FOUND", `Event ${command.eventId} was not found.`);
      }
      if (aggregate.attendanceRevision !== command.baseAttendanceRevision) {
        throw new AppError(
          "ATTENDANCE_CONFLICT",
          "Attendance was saved elsewhere since you loaded it. Reload, then generate again.",
        );
      }
      return this.buildCaptured(aggregate);
    });
  }

  /**
   * TX10: the batch reads current saved data and clears the pending flag in one transaction (T4).
   * A note committed after it sets the flag again and schedules its own job (T4-09). There is no
   * revision check: a batch always reads what is saved now.
   */
  private captureForBatch(eventId: EventId): Promise<CapturedInput & { unchanged: boolean }> {
    return this.deps.uow.run(async (tx) => {
      const aggregate = await tx.events.lockForUpdate(eventId);
      await tx.events.clearFeedbackPending(eventId);
      const latest = await tx.generations.latestInput(eventId);
      const captured = await this.buildCaptured(aggregate);
      return { ...captured, unchanged: latest !== null && sameInput(latest, captured) };
    });
  }

  private async buildCaptured(aggregate: EventAggregate): Promise<CapturedInput> {
    const notes = aggregate.feedback.map(({ id, text }) => ({ id, text }));
    return {
      capturedAt: this.deps.clock.now(),
      attendance: aggregate.members.map((m) => ({ memberId: m.id, attendance: m.attendance })),
      feedbackIds: notes.map((note) => note.id),
      feedbackDigest: await feedbackDigest(notes),
      input: {
        event: {
          id: aggregate.event.id,
          name: aggregate.event.name,
          status: aggregate.event.status,
        },
        counts: deriveAttendanceCounts(aggregate.members),
        feedback: notes,
      },
    };
  }

  /** F4 rules 1–5 against the CAPTURED note set; any failure rejects the whole candidate. */
  private validate(
    result: BriefingGenerateV1Result,
    capturedIds: readonly FeedbackId[],
  ): EvidenceSections | null {
    const parsed = buildGeneratedSectionsSchema(capturedIds).safeParse(result.sections);
    if (!parsed.success) return null;
    const evidence = validateEvidenceSections(parsed.data, capturedIds);
    return evidence.ok ? evidence.sections : null;
  }

  /**
   * TX5: lock, apply the F7 incoming-slot rules, insert, record the outcome; publish after commit.
   * A run commits at most once (T4-05): under the lock, a run that already has an outcome (or,
   * once its outcome was pruned, a generation) writes nothing and reports what it recorded then.
   */
  private commit(
    run: RunRef,
    captured: CapturedInput,
    result: BriefingGenerateV1Result,
    sections: EvidenceSections,
  ): Promise<{ status: RunOutcomeStatus; views: BriefingViews }> {
    const { eventId, runId, trigger } = run;
    return this.deps.uow.run(async (tx) => {
      const aggregate = await tx.events.lockForUpdate(eventId);
      const now = this.deps.clock.now();
      const recorded =
        (await tx.outcomes.statusOf(runId)) ??
        ((await tx.generations.findIdByRunId(runId)) === null ? null : "succeeded");
      let status: RunOutcomeStatus = recorded ?? "succeeded";
      if (recorded === null) {
        const current = await tx.slots.incoming(eventId);
        const decision = decideIncoming(current, {
          trigger,
          inputCapturedAt: captured.capturedAt,
        });
        const outcome = { runId, eventId, trigger, finishedAt: now };
        if (decision.kind === "replace") {
          const generationId = this.deps.ids.generationId();
          await tx.generations.insert({
            id: generationId,
            eventId,
            runId,
            trigger,
            model: result.model,
            promptVersion: result.promptVersion,
            attendanceOverview: buildAttendanceOverview(captured.input.counts),
            feedbackDigest: captured.feedbackDigest,
            inputCapturedAt: captured.capturedAt,
            generatedAt: now,
            attendance: captured.attendance,
            feedbackIds: captured.feedbackIds,
            items: toGenerationItems(sections, () => this.deps.ids.itemId()),
          });
          await tx.slots.putIncoming(eventId, generationId, now);
          if (current !== null)
            await tx.generations.deleteIfUnreferenced(eventId, current.generationId);
          await tx.outcomes.record({
            ...outcome,
            status: "succeeded",
            errorCode: null,
            generationId,
          });
        } else {
          status = decision.outcome;
          await tx.outcomes.record({
            ...outcome,
            status: decision.outcome,
            errorCode: null,
            generationId: null,
          });
        }
        tx.afterCommit(() => this.deps.changes.publish(eventId));
      }
      const views = await loadBriefingViews(tx, eventId, aggregate.members, aggregate.feedback);
      return { status, views };
    });
  }

  /** TX6 for a manual run: record the failure and hand the original error back to throw. */
  private async failManual(run: RunRef, error: AppError): Promise<AppError> {
    this.deps.logger.warn({ runId: run.runId, code: error.code }, "manual generation failed");
    await this.recordOutcome(run, { status: "failed", errorCode: error.code });
    return error;
  }

  /**
   * TX6: record a run's outcome without a generation and tell readers. The event row is locked
   * first like every write transaction (T4 §6): `record` prunes with a range DELETE that could
   * otherwise deadlock with a concurrent TX5 on the same event. Never throws: a failed write is
   * logged and followed by a direct publish, so it never hides the run's own result.
   */
  private async recordOutcome(run: RunRef, result: OutcomeResult): Promise<void> {
    const { eventId, runId, trigger } = run;
    if (trigger === "feedback_batch" && result.status === "failed") {
      this.deps.logger.warn({ runId, code: result.errorCode }, "automatic generation failed");
    }
    try {
      await this.deps.uow.run(async (tx) => {
        await tx.events.lockForUpdate(eventId);
        await tx.outcomes.record({
          ...result,
          runId,
          eventId,
          trigger,
          generationId: null,
          finishedAt: this.deps.clock.now(),
        });
        tx.afterCommit(() => this.deps.changes.publish(eventId));
      });
    } catch (recordError) {
      this.deps.logger.warn({ err: recordError, runId }, "could not record the run's outcome");
      try {
        await this.deps.changes.publish(eventId);
      } catch (publishError) {
        this.deps.logger.warn(
          { err: publishError, runId },
          "could not flush after the run's outcome",
        );
      }
    }
  }
}
