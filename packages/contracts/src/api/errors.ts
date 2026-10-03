import { z } from "zod";

export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "ORIGIN_REJECTED",
  "EVENT_NOT_FOUND",
  "NOT_FOUND",
  "ATTENDANCE_CONFLICT",
  "BRIEFING_CONFLICT",
  "PREVIEW_CONFLICT",
  "GENERATION_NOT_AVAILABLE",
  "CONTENT_INVALID",
  "REFERENCE_INVALID",
  "FEEDBACK_LIMIT_REACHED",
  "PROVIDER_COOLDOWN",
  "DAILY_LIMIT_REACHED",
  "OUTPUT_INVALID",
  "OUTPUT_INCOMPLETE",
  "PROVIDER_REFUSED",
  "GATEWAY_UNAVAILABLE",
  "PROVIDER_NOT_CONFIGURED",
  "AI_OUTCOME_UNKNOWN",
  "DEADLINE_EXCEEDED",
  "STORE_UNAVAILABLE",
  "STORE_CORRUPT",
  "QUEUE_UNAVAILABLE",
  "RESULT_PERSIST_FAILED",
  "INTERNAL",
  // Batch outcomes. Their statuses in the map below exist only to keep it total; the manual
  // path must map gateway failures to the HTTP codes above (Plan 3 adds the type split).
  "GATEWAY_AUTH_FAILED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_TEMPORARY",
  "ATTEMPTS_EXHAUSTED",
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** One total map, so the Express error middleware needs no switch of its own (T3 §10). */
export const ERROR_HTTP_STATUS = {
  VALIDATION_FAILED: 400,
  ORIGIN_REJECTED: 403,
  EVENT_NOT_FOUND: 404,
  NOT_FOUND: 404,
  ATTENDANCE_CONFLICT: 409,
  BRIEFING_CONFLICT: 409,
  PREVIEW_CONFLICT: 409,
  GENERATION_NOT_AVAILABLE: 409,
  CONTENT_INVALID: 422,
  REFERENCE_INVALID: 422,
  FEEDBACK_LIMIT_REACHED: 422,
  PROVIDER_COOLDOWN: 429,
  DAILY_LIMIT_REACHED: 429,
  OUTPUT_INVALID: 502,
  OUTPUT_INCOMPLETE: 502,
  PROVIDER_REFUSED: 502,
  GATEWAY_UNAVAILABLE: 503,
  PROVIDER_NOT_CONFIGURED: 503,
  AI_OUTCOME_UNKNOWN: 504,
  DEADLINE_EXCEEDED: 504,
  STORE_UNAVAILABLE: 503,
  STORE_CORRUPT: 500,
  QUEUE_UNAVAILABLE: 503,
  RESULT_PERSIST_FAILED: 500,
  INTERNAL: 500,
  GATEWAY_AUTH_FAILED: 503,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_TEMPORARY: 503,
  ATTEMPTS_EXHAUSTED: 503,
} as const satisfies Record<ErrorCode, number>;

export const ApiErrorBodySchema = z.strictObject({
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    field: z.string().optional(),
    retryAfterMs: z.int().min(0).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
