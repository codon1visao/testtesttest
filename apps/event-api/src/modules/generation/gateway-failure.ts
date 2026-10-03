import { assertNever } from "@event-desk/contracts";
import type { BriefingCallResult } from "../../ports/ai-gateway-client.js";
import { AppError } from "../../shared/app-error.js";

const DEFAULT_COOLDOWN_MS = 60_000;
const UNCHANGED = "Your saved work is unchanged";

/**
 * A failed Gateway attempt → the HTTP error the coordinator sees (T3 §5). Messages are fixed,
 * actionable sentences; uncertain outcomes say the attempt may have been charged (F8).
 */
export function gatewayFailureError(failure: Extract<BriefingCallResult, { ok: false }>): AppError {
  switch (failure.code) {
    case "GATEWAY_UNAVAILABLE":
    case "GATEWAY_AUTH_FAILED":
      return new AppError(
        "GATEWAY_UNAVAILABLE",
        `The AI service is not reachable. ${UNCHANGED}; try again shortly.`,
      );
    case "PROVIDER_TEMPORARY":
      return new AppError(
        "GATEWAY_UNAVAILABLE",
        `The AI provider is temporarily unavailable. ${UNCHANGED}; try again shortly.`,
      );
    case "VALIDATION_FAILED":
    case "INTERNAL":
      return new AppError("INTERNAL", `Briefing generation failed unexpectedly. ${UNCHANGED}.`);
    case "PROVIDER_NOT_CONFIGURED":
      return new AppError(
        "PROVIDER_NOT_CONFIGURED",
        "The AI service has no provider configured. Ask the administrator to set the OpenAI key.",
      );
    case "PROVIDER_RATE_LIMITED": {
      const retryAfterMs = failure.retryAfterMs ?? DEFAULT_COOLDOWN_MS;
      return new AppError(
        "PROVIDER_COOLDOWN",
        `The AI provider is limiting requests. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`,
        { retryAfterMs },
      );
    }
    case "DAILY_LIMIT_REACHED":
      return new AppError(
        "DAILY_LIMIT_REACHED",
        `Today's generation limit is reached. ${UNCHANGED}.`,
      );
    case "PROVIDER_REFUSED":
      return new AppError(
        "PROVIDER_REFUSED",
        `The AI model declined to write this briefing. ${UNCHANGED}.`,
      );
    case "OUTPUT_INCOMPLETE":
      return new AppError(
        "OUTPUT_INCOMPLETE",
        `The AI model's answer was cut off. ${UNCHANGED}; you can generate again.`,
      );
    case "OUTPUT_INVALID":
      return new AppError(
        "OUTPUT_INVALID",
        `The AI model's answer broke the briefing rules and was discarded. ${UNCHANGED}.`,
      );
    case "DEADLINE_EXCEEDED":
      return new AppError(
        "DEADLINE_EXCEEDED",
        `The AI model did not finish in time; the attempt may have been charged. ${UNCHANGED}.`,
      );
    case "AI_OUTCOME_UNKNOWN":
      return new AppError(
        "AI_OUTCOME_UNKNOWN",
        `The connection to the AI service was lost after the request was sent; the attempt may have been charged. ${UNCHANGED}.`,
      );
    default:
      return assertNever(failure.code, "gateway error code");
  }
}
