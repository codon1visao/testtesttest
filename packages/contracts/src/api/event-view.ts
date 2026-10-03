import { z } from "zod";
import { AttendanceCountsSchema, MemberAttendanceSchema, MemberSchema } from "../attendance.js";
import { BriefingContentSchema } from "../briefing-content.js";
import { EventSummarySchema } from "../event.js";
import { FeedbackNoteSchema } from "../feedback.js";
import { FreshnessSchema } from "../freshness.js";
import { FeedbackIdSchema, GenerationIdSchema, RunIdSchema } from "../ids.js";
import { ErrorCodeSchema } from "./errors.js";

const timestamp = z.iso.datetime();

/** Internal optimistic-concurrency token (A5); never a history record. */
export const RevisionSchema = z.int().min(0);

export const GENERATION_TRIGGERS = ["manual", "feedback_batch"] as const;
export const GenerationTriggerSchema = z.enum(GENERATION_TRIGGERS);
export type GenerationTrigger = z.infer<typeof GenerationTriggerSchema>;

/** What the generation read; assignable to FreshnessBaseline. */
export const GenerationInputSchema = z.strictObject({
  attendance: z.array(MemberAttendanceSchema),
  counts: AttendanceCountsSchema,
  feedbackIds: z.array(FeedbackIdSchema),
  feedbackDigest: z.string().regex(/^[0-9a-f]{64}$/),
});
export type GenerationInput = z.infer<typeof GenerationInputSchema>;

export const GenerationProvenanceSchema = z.strictObject({
  generationId: GenerationIdSchema,
  runId: RunIdSchema,
  generatedAt: timestamp,
  model: z.string().min(1).max(100),
  promptVersion: z.string().min(1).max(32),
  input: GenerationInputSchema,
});
export type GenerationProvenance = z.infer<typeof GenerationProvenanceSchema>;

export const BriefingViewSchema = z.strictObject({
  provenance: GenerationProvenanceSchema,
  content: BriefingContentSchema,
  savedAt: timestamp.optional(),
  freshness: FreshnessSchema,
  trigger: GenerationTriggerSchema,
});
export type BriefingView = z.infer<typeof BriefingViewSchema>;

export const RUN_OUTCOME_STATUSES = [
  "succeeded",
  "failed",
  "skipped",
  "superseded",
  "superseded_by_manual",
] as const;
export const BATCH_STATES = ["collecting", "waiting", "generating", "retry_wait"] as const;

export const GenerationStatusViewSchema = z.strictObject({
  manual: z.strictObject({ runId: RunIdSchema, startedAt: timestamp }).nullable(),
  batch: z
    .strictObject({
      state: z.enum(BATCH_STATES),
      jobId: RunIdSchema,
      closesAt: timestamp.optional(),
      nextAttemptAt: timestamp.optional(),
      attempt: z.int().min(1).optional(),
      maxAttempts: z.int().min(1).optional(), // renders F7's "attempt 2 of 3"
      newNoteIds: z.array(FeedbackIdSchema),
    })
    .nullable(),
  lastOutcome: z
    .strictObject({
      runId: RunIdSchema,
      trigger: GenerationTriggerSchema,
      status: z.enum(RUN_OUTCOME_STATUSES),
      code: ErrorCodeSchema.optional(),
      finishedAt: timestamp,
    })
    .refine((outcome) => (outcome.status === "failed") === (outcome.code !== undefined), {
      message: "A failed outcome carries an error code; other outcomes do not",
    })
    .nullable(),
  cooldownUntil: timestamp.nullable(),
});
export type GenerationStatusView = z.infer<typeof GenerationStatusViewSchema>;

export const EventViewSchema = z.strictObject({
  event: EventSummarySchema,
  members: z.array(MemberSchema),
  feedback: z.array(FeedbackNoteSchema),
  counts: AttendanceCountsSchema,
  attendanceRevision: RevisionSchema,
  briefingRevision: RevisionSchema,
  savedBriefing: BriefingViewSchema.nullable(),
  selectedPreview: BriefingViewSchema.nullable(),
  incomingPreview: BriefingViewSchema.nullable(),
  generation: GenerationStatusViewSchema,
});
export type EventView = z.infer<typeof EventViewSchema>;

/** Payload of the SSE `changed` message (A16). */
export const EventChangedMessageSchema = z.strictObject({ version: z.int().min(0) });
export type EventChangedMessage = z.infer<typeof EventChangedMessageSchema>;
