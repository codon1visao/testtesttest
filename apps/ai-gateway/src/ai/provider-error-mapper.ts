import {
  MaxTurnsExceededError,
  ModelBehaviorError,
  ModelRefusalError,
  ModelTimeoutError,
} from "@openai/agents-core";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "openai";
import { GatewayError } from "../shared/gateway-error.js";

const NETWORK_UNREACHABLE = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

/** A non-negative number from a header; absent, blank or non-numeric (e.g. an HTTP date) → undefined. */
function numericHeader(headers: Headers | undefined, name: string): number | undefined {
  const raw = headers?.get(name)?.trim() ?? "";
  if (raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function retryAfterMsFrom(headers: Headers | undefined): number | undefined {
  const ms = numericHeader(headers, "retry-after-ms");
  if (ms !== undefined) return Math.round(ms);
  const seconds = numericHeader(headers, "retry-after");
  return seconds === undefined ? undefined : Math.round(seconds * 1000);
}

/** True when the cause chain shows the provider host was never reached (DNS or refused connection). */
function neverReached(error: unknown): boolean {
  for (let cause: unknown = error, depth = 0; cause instanceof Error && depth < 5; depth += 1) {
    if ("code" in cause && typeof cause.code === "string" && NETWORK_UNREACHABLE.has(cause.code))
      return true;
    cause = cause.cause;
  }
  return false;
}

/**
 * SDK and provider failures → stable Gateway codes with fixed messages (F8). Provider text never
 * leaves this function: SDK messages can contain model output (e.g. a refusal). Order matters:
 * `APIConnectionTimeoutError` extends `APIConnectionError`, and `APIUserAbortError` and
 * `APIConnectionError` both extend `APIError`, so the specific classes are checked first.
 */
export function mapProviderError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  const sent = { notSent: false, cause: error };

  if (error instanceof ModelRefusalError) {
    return new GatewayError("PROVIDER_REFUSED", "The model declined to produce a briefing.", sent);
  }
  if (error instanceof ModelBehaviorError && error.message.includes("response.incomplete")) {
    return new GatewayError(
      "OUTPUT_INCOMPLETE",
      "The model's output was cut off before it was complete.",
      sent,
    );
  }
  if (error instanceof ModelBehaviorError || error instanceof MaxTurnsExceededError) {
    return new GatewayError(
      "OUTPUT_INVALID",
      "The model returned output that does not match the briefing format.",
      sent,
    );
  }
  if (error instanceof APIUserAbortError) {
    return deadlineExceeded(error);
  }
  if (error instanceof APIConnectionTimeoutError || error instanceof ModelTimeoutError) {
    return new GatewayError(
      "AI_OUTCOME_UNKNOWN",
      "The provider call timed out after it was sent; the outcome is unknown.",
      sent,
    );
  }
  if (error instanceof APIConnectionError) {
    return neverReached(error)
      ? new GatewayError("PROVIDER_TEMPORARY", "The AI provider could not be reached.", {
          notSent: true,
          cause: error,
        })
      : new GatewayError(
          "AI_OUTCOME_UNKNOWN",
          "The provider connection failed after the request was sent; the outcome is unknown.",
          sent,
        );
  }
  if (error instanceof RateLimitError) {
    const retryAfterMs = retryAfterMsFrom(error.headers);
    return new GatewayError("PROVIDER_RATE_LIMITED", "The AI provider is rate limiting requests.", {
      ...sent,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  // 409 is a transient provider-side conflict (the openai SDK itself treats it as retryable).
  if (error instanceof ConflictError) {
    return new GatewayError(
      "PROVIDER_TEMPORARY",
      "The AI provider is temporarily unavailable.",
      sent,
    );
  }
  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError ||
    error instanceof BadRequestError ||
    error instanceof NotFoundError ||
    error instanceof UnprocessableEntityError
  ) {
    return new GatewayError(
      "PROVIDER_NOT_CONFIGURED",
      "The AI provider rejected the Gateway's configuration.",
      sent,
    );
  }
  if (error instanceof APIError) {
    return new GatewayError(
      "PROVIDER_TEMPORARY",
      "The AI provider is temporarily unavailable.",
      sent,
    );
  }
  return new GatewayError("INTERNAL", "The Gateway failed unexpectedly.", sent);
}

function deadlineExceeded(cause: unknown): GatewayError {
  return new GatewayError("DEADLINE_EXCEEDED", "The model did not answer before the deadline.", {
    notSent: false,
    cause,
  });
}

/**
 * A failed agent run → GatewayError. Once our deadline signal has fired, the failure is the deadline
 * whatever its class: agents-core's `throwIfAborted()` rethrows `signal.reason` (a DOMException
 * AbortError or TimeoutError) after a model response, which mapProviderError alone would call INTERNAL.
 */
export function mapRunFailure(error: unknown, signal: AbortSignal): GatewayError {
  return signal.aborted ? deadlineExceeded(error) : mapProviderError(error);
}
