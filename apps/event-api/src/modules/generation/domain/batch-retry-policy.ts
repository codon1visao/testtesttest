import { assertNever } from "@event-desk/contracts";
import type { GatewayErrorCode } from "@event-desk/contracts/gateway-rpc";

/**
 * F7 "Failures, retries and cost limits", F8: retry only known pre-dispatch connection failures and
 * explicit temporary provider errors or rate limits. An uncertain dispatch is never replayed.
 */
export function isRetryableGatewayFailure(code: GatewayErrorCode, notSent: boolean): boolean {
  switch (code) {
    case "PROVIDER_TEMPORARY":
    case "PROVIDER_RATE_LIMITED":
      return true;
    case "GATEWAY_UNAVAILABLE":
    case "DEADLINE_EXCEEDED":
      return notSent;
    case "AI_OUTCOME_UNKNOWN":
    case "GATEWAY_AUTH_FAILED":
    case "VALIDATION_FAILED":
    case "PROVIDER_NOT_CONFIGURED":
    case "PROVIDER_REFUSED":
    case "OUTPUT_INCOMPLETE":
    case "OUTPUT_INVALID":
    case "DAILY_LIMIT_REACHED":
    case "INTERNAL":
      return false;
    default:
      return assertNever(code, "gateway error code");
  }
}

export const BATCH_ATTEMPT_TIMEOUT_MS = 60_000;

export interface RetryDelayInput {
  attempt: number;
  maxAttempts: number;
  retryAfterMs?: number;
  cooldownRemainingMs?: number;
  now: number;
  executionDeadline: number;
  random: number;
}

/** F7: exponential backoff with ±20% jitter, never shorter than the provider's wait or the cooldown. */
export function nextRetryDelayMs(input: RetryDelayInput): number | null {
  if (input.attempt >= input.maxAttempts) return null;
  const exponential = 2_000 * 2 ** (input.attempt - 1) * (0.8 + 0.4 * input.random);
  const delay = Math.ceil(
    Math.max(exponential, input.retryAfterMs ?? 0, input.cooldownRemainingMs ?? 0),
  );
  return input.now + delay >= input.executionDeadline ? null : delay;
}

export function attemptDeadline(
  now: number,
  executionDeadline: number,
  timeoutMs = BATCH_ATTEMPT_TIMEOUT_MS,
): Date {
  return new Date(Math.min(now + timeoutMs, executionDeadline));
}
