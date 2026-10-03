import {
  type BriefingView,
  buildGeneratedSectionsSchema,
  deriveAttendanceCounts,
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
} from "@event-desk/contracts/gateway-rpc";
import type { AiGatewayClient, BriefingCallResult } from "../../ports/ai-gateway-client.js";
import type { Clock } from "../../ports/clock.js";
import type { AttemptReservation, GenerationLimits } from "../../ports/generation-limits.js";
import type { IdGenerator } from "../../ports/id-generator.js";
import type { UnitOfWork } from "../../ports/unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import type { Logger } from "../../shared/logger.js";
import { loadBriefingViews } from "../briefing/briefing-views.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import { buildAttendanceOverview } from "./domain/attendance-overview.js";
import { toGenerationItems } from "./domain/generation-items.js";
import { decideIncoming } from "./domain/incoming-slot-rules.js";
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

/** What TX4 read: the generation's immutable input. */
interface CapturedInput {
  capturedAt: Date;
  attendance: MemberAttendance[];
  feedbackIds: FeedbackId[];
  feedbackDigest: string;
  input: BriefingGenerateV1Input;
}

/**
 * The one generation path (T5 §1): capture saved input, call the Gateway with no transaction
 * open, validate against the captured snapshot, commit with the incoming-slot rules. Manual runs
 * are never retried here; the batch processor (Plan 5) reuses these steps.
 */
export class BriefingGenerationService {
  constructor(private readonly deps: BriefingGenerationDeps) {}

  async generateManual(command: ManualGenerateCommand): Promise<BriefingView> {
    const started = Date.now();
    const captured = await this.capture(command);
    const now = this.deps.clock.now();
    const cooldownEnd = await this.deps.limits.cooldownUntil(command.eventId, now);
    if (cooldownEnd !== null) throw cooldownError(cooldownEnd.getTime() - now.getTime());
    const reservation = await this.deps.limits.reserveAttempt(command.eventId, "manual", now);
    if (reservation.kind === "limit-reached") throw dailyLimitError();
    const call = await this.deps.gateway.generateBriefing({
      runId: command.runId,
      attemptId: "1",
      lane: "interactive",
      deadlineAt: command.deadlineAt,
      input: captured.input,
    });
    if (!call.ok) {
      await this.settleFailedCall(command.eventId, "manual", reservation, call);
      if (call.code === "GATEWAY_AUTH_FAILED") {
        this.deps.logger.error(
          { runId: command.runId },
          "GATEWAY_SERVICE_SECRET differs between event API and Gateway",
        );
      }
      throw await this.fail(command, gatewayFailureError(call));
    }
    if (this.deps.clock.now().getTime() > command.deadlineAt.getTime()) {
      throw await this.fail(
        command,
        gatewayFailureError({ ok: false, code: "DEADLINE_EXCEEDED", notSent: false }),
      );
    }
    const sections = this.validate(call.result, captured.feedbackIds);
    if (sections === null) {
      throw await this.fail(
        command,
        gatewayFailureError({ ok: false, code: "OUTPUT_INVALID", notSent: false }),
      );
    }

    let preview: BriefingView;
    try {
      preview = await this.commit(command, captured, call.result, sections);
    } catch (error) {
      this.deps.logger.error(
        { err: error, runId: command.runId },
        "generated briefing could not be stored",
      );
      throw await this.fail(
        command,
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
  private capture(command: ManualGenerateCommand): Promise<CapturedInput> {
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
    });
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

  /** TX5: lock, apply the F7 incoming-slot rules, insert, record the outcome; flush after commit. */
  private commit(
    command: ManualGenerateCommand,
    captured: CapturedInput,
    result: BriefingGenerateV1Result,
    sections: EvidenceSections,
  ): Promise<BriefingView> {
    return this.deps.uow.run(async (tx) => {
      const aggregate = await tx.events.lockForUpdate(command.eventId);
      const now = this.deps.clock.now();
      if ((await tx.generations.findIdByRunId(command.runId)) === null) {
        const current = await tx.slots.incoming(command.eventId);
        const decision = decideIncoming(current, {
          trigger: "manual",
          inputCapturedAt: captured.capturedAt,
        });
        const outcome = {
          runId: command.runId,
          eventId: command.eventId,
          trigger: "manual" as const,
          errorCode: null,
          finishedAt: now,
        };
        if (decision.kind === "replace") {
          const generationId = this.deps.ids.generationId();
          await tx.generations.insert({
            id: generationId,
            eventId: command.eventId,
            runId: command.runId,
            trigger: "manual",
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
          await tx.slots.putIncoming(command.eventId, generationId, now);
          if (current !== null)
            await tx.generations.deleteIfUnreferenced(command.eventId, current.generationId);
          await tx.outcomes.record({ ...outcome, status: "succeeded", generationId });
        } else {
          await tx.outcomes.record({ ...outcome, status: decision.outcome, generationId: null });
        }
        tx.afterCommit(() => this.deps.changes.publish(command.eventId));
      }
      const views = await loadBriefingViews(
        tx,
        command.eventId,
        aggregate.members,
        aggregate.feedback,
      );
      if (views.incomingPreview === null) {
        throw new AppError("INTERNAL", "The generated briefing is missing after its commit.");
      }
      return views.incomingPreview;
    });
  }

  /**
   * TX6: record the failed run and tell readers; never hides the original error. The event row is
   * locked first like every write transaction (T4 §6): `record` prunes with a range DELETE that
   * could otherwise deadlock with a concurrent TX5 on the same event.
   */
  private async fail(command: ManualGenerateCommand, error: AppError): Promise<AppError> {
    this.deps.logger.warn({ runId: command.runId, code: error.code }, "manual generation failed");
    try {
      await this.deps.uow.run(async (tx) => {
        await tx.events.lockForUpdate(command.eventId);
        await tx.outcomes.record({
          runId: command.runId,
          eventId: command.eventId,
          trigger: "manual",
          status: "failed",
          errorCode: error.code,
          generationId: null,
          finishedAt: this.deps.clock.now(),
        });
        tx.afterCommit(() => this.deps.changes.publish(command.eventId));
      });
    } catch (recordError) {
      this.deps.logger.warn(
        { err: recordError, runId: command.runId },
        "could not record the failed run",
      );
      try {
        await this.deps.changes.publish(command.eventId);
      } catch (publishError) {
        this.deps.logger.warn(
          { err: publishError, runId: command.runId },
          "could not flush after the failed run",
        );
      }
    }
    return error;
  }
}
