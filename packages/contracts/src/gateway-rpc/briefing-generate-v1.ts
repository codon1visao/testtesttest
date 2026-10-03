import { z } from "zod";
import { AttendanceCountsSchema } from "../attendance.js";
import { BriefingContentSchema } from "../briefing-content.js";
import { EventSummarySchema } from "../event.js";
import { FeedbackNoteSchema } from "../feedback.js";
import { GatewayErrorCodeSchema } from "./gateway-error-codes.js";

export const BRIEFING_GENERATE_V1 = "briefing.generate.v1";

/** One in-flight provider call per lane: a batch can never take the coordinator's slot (T5 §4). */
export const GATEWAY_LANES = ["interactive", "background"] as const;
export const GatewayLaneSchema = z.enum(GATEWAY_LANES);
export type GatewayLane = z.infer<typeof GatewayLaneSchema>;

/**
 * S1 limits. Note text is FeedbackTextSchema (≤ 1,000 characters, so ≤ 4 KiB of UTF-8), which
 * meets the per-note limit; the total is checked here. Oversized input is rejected, never truncated.
 */
export const GATEWAY_INPUT_LIMITS = { maxNotes: 100, maxSourceBytes: 32 * 1024 } as const;

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Correlation IDs are backend-owned opaque tokens (UUIDs, attempt numbers). */
export const RpcIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/, "Invalid correlation ID");
export type RpcId = z.infer<typeof RpcIdSchema>;

const correlation = { requestId: RpcIdSchema, runId: RpcIdSchema, attemptId: RpcIdSchema };

/** Enough of any request to answer it with matching IDs, even for an unknown operation. */
export const GatewayRequestHeaderSchema = z.looseObject({
  v: z.literal(1),
  operation: z.string().min(1).max(64),
  ...correlation,
});
export type GatewayRequestHeader = z.infer<typeof GatewayRequestHeaderSchema>;

const BriefingFeedbackInputSchema = FeedbackNoteSchema.pick({ id: true, text: true });

/** Only what the briefing needs (S1): no roster, names, human edits or provenance. */
export const BriefingGenerateV1InputSchema = z.strictObject({
  event: EventSummarySchema.pick({ id: true, name: true, status: true }),
  counts: AttendanceCountsSchema,
  feedback: z
    .array(BriefingFeedbackInputSchema)
    .min(1)
    .max(GATEWAY_INPUT_LIMITS.maxNotes)
    .refine((notes) => new Set(notes.map((note) => note.id)).size === notes.length, {
      message: "Feedback IDs must be unique",
    })
    .refine(
      (notes) => utf8ByteLength(JSON.stringify(notes)) <= GATEWAY_INPUT_LIMITS.maxSourceBytes,
      {
        message: `Feedback must be at most ${GATEWAY_INPUT_LIMITS.maxSourceBytes} bytes`,
      },
    ),
});
export type BriefingGenerateV1Input = z.infer<typeof BriefingGenerateV1InputSchema>;

/** The request after tcp-rpc has verified and removed `auth`. Unknown fields are rejected. */
export const BriefingGenerateV1RequestSchema = z.strictObject({
  v: z.literal(1),
  operation: z.literal(BRIEFING_GENERATE_V1),
  ...correlation,
  lane: GatewayLaneSchema,
  deadlineAt: z.iso.datetime(),
  input: BriefingGenerateV1InputSchema,
});
export type BriefingGenerateV1Request = z.infer<typeof BriefingGenerateV1RequestSchema>;

/**
 * The candidate's sections: the briefing content without the attendance overview, which the event
 * backend derives from its own counts. The backend still applies validateEvidenceSections (F4).
 */
export const GeneratedSectionsWireSchema = BriefingContentSchema.omit({ attendanceOverview: true });
export type GeneratedSectionsWire = z.infer<typeof GeneratedSectionsWireSchema>;

export const BriefingGenerateV1ResultSchema = z.strictObject({
  sections: GeneratedSectionsWireSchema,
  model: z.string().min(1).max(100),
  promptVersion: z.string().min(1).max(50),
  providerRequestId: z.string().min(1).max(200).nullable(),
  usage: z.strictObject({ inputTokens: z.int().min(0), outputTokens: z.int().min(0) }),
});
export type BriefingGenerateV1Result = z.infer<typeof BriefingGenerateV1ResultSchema>;

/** A bounded, safe error: fixed message, no provider text (F8). */
export const GatewayErrorSchema = z.strictObject({
  code: GatewayErrorCodeSchema,
  message: z.string().min(1).max(300),
  /**
   * True only when the provider request is known not to have been sent: safe to try again.
   * False means the provider may have received, and billed, the request, whatever the code
   * (including DEADLINE_EXCEEDED after the send and AI_OUTCOME_UNKNOWN). Callers treat every
   * `notSent: false` failure as a possibly paid attempt: confirm before a Retry, never replay it.
   */
  notSent: z.boolean(),
  retryAfterMs: z.int().min(0).optional(),
});
export type GatewayErrorBody = z.infer<typeof GatewayErrorSchema>;

export const BriefingGenerateV1ResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    v: z.literal(1),
    ok: z.literal(true),
    ...correlation,
    result: BriefingGenerateV1ResultSchema,
  }),
  z.strictObject({
    v: z.literal(1),
    ok: z.literal(false),
    requestId: RpcIdSchema.nullable(),
    runId: RpcIdSchema.nullable(),
    attemptId: RpcIdSchema.nullable(),
    error: GatewayErrorSchema,
  }),
]);
export type BriefingGenerateV1Response = z.infer<typeof BriefingGenerateV1ResponseSchema>;
