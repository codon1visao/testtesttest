import { assertNever, type ErrorCode, type GenerationStatusView } from "@event-desk/contracts";

export type ClockFormat = (iso: string) => string;

const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
/** HH:MM:SS, 24-hour, in the browser's locale. */
export const formatClock: ClockFormat = (iso) => clockFormat.format(new Date(iso));

export const BATCH_READY_TEXT = "New automatic briefing ready to review.";

/**
 * F7 "Generation state in the UI" text for a live batch; null for a collecting job whose notes a
 * previous job already captured (it will find nothing new and skip).
 */
export function batchStateText(
  batch: NonNullable<GenerationStatusView["batch"]>,
  clock: ClockFormat = formatClock,
): string | null {
  switch (batch.state) {
    case "collecting": {
      const n = batch.newNoteIds.length;
      if (n === 0) return null;
      const received = `New feedback received (${String(n)} ${n === 1 ? "note" : "notes"}).`;
      return batch.closesAt === undefined
        ? `${received} Preparing an automatic briefing.`
        : `${received} Preparing an automatic briefing at ${clock(batch.closesAt)}.`;
    }
    case "waiting":
      return "Automatic briefing queued; waiting for the current generation to finish.";
    case "generating":
      return "Generating automatic briefing…";
    case "retry_wait": {
      // No invented defaults: say only what the server reported.
      const when =
        batch.nextAttemptAt === undefined ? "shortly" : `at ${clock(batch.nextAttemptAt)}`;
      const count =
        batch.attempt === undefined || batch.maxAttempts === undefined
          ? ""
          : ` (attempt ${String(batch.attempt)} of ${String(batch.maxAttempts)})`;
      return `Automatic briefing will retry ${when}${count}.`;
    }
    default:
      return assertNever(batch.state, "batch state");
  }
}

const UNAVAILABLE = "AI service unavailable";
const LIMITING = "the AI provider is limiting requests";
const UNCONFIRMED = "the AI service did not confirm the result";
const UNUSABLE = "the AI model's answer was unusable";
const NOT_STORED = "the result could not be stored";
const UNEXPECTED = "an unexpected error";

/** Total over every error code: TypeScript rejects a code added to the contract but not worded here. */
const REASONS: Record<ErrorCode, string> = {
  VALIDATION_FAILED: UNEXPECTED,
  ORIGIN_REJECTED: UNEXPECTED,
  EVENT_NOT_FOUND: UNEXPECTED,
  NOT_FOUND: UNEXPECTED,
  ATTENDANCE_CONFLICT: UNEXPECTED,
  BRIEFING_CONFLICT: UNEXPECTED,
  PREVIEW_CONFLICT: UNEXPECTED,
  GENERATION_NOT_AVAILABLE: UNEXPECTED,
  CONTENT_INVALID: UNEXPECTED,
  REFERENCE_INVALID: UNEXPECTED,
  FEEDBACK_LIMIT_REACHED: UNEXPECTED,
  PROVIDER_COOLDOWN: LIMITING,
  DAILY_LIMIT_REACHED: "today's automatic generation limit is reached",
  OUTPUT_INVALID: UNUSABLE,
  OUTPUT_INCOMPLETE: UNUSABLE,
  PROVIDER_REFUSED: "the AI model declined to write it",
  GATEWAY_UNAVAILABLE: UNAVAILABLE,
  PROVIDER_NOT_CONFIGURED: UNAVAILABLE,
  AI_OUTCOME_UNKNOWN: UNCONFIRMED,
  DEADLINE_EXCEEDED: UNCONFIRMED,
  STORE_UNAVAILABLE: NOT_STORED,
  STORE_CORRUPT: NOT_STORED,
  QUEUE_UNAVAILABLE: UNAVAILABLE,
  RESULT_PERSIST_FAILED: NOT_STORED,
  INTERNAL: UNEXPECTED,
  GATEWAY_AUTH_FAILED: UNAVAILABLE,
  PROVIDER_RATE_LIMITED: LIMITING,
  PROVIDER_TEMPORARY: UNAVAILABLE,
  ATTEMPTS_EXHAUSTED: UNAVAILABLE,
};

/** The short reason in "Automatic briefing failed: {reason}. …". */
export const batchFailureReason = (code: ErrorCode | undefined): string =>
  code === undefined ? UNEXPECTED : REASONS[code];

export const batchFailureText = (code: ErrorCode | undefined): string =>
  `Automatic briefing failed: ${batchFailureReason(code)}. Your saved briefing is unchanged.`;
