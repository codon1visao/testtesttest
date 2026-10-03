import { assertNever } from "@event-desk/contracts";
import type { BriefingCallResult } from "../../ports/ai-gateway-client.js";
import { AppError } from "../../shared/app-error.js";

export const DEFAULT_COOLDOWN_MS = 60_000;
const UNCHANGED = "Your saved work is unchanged";

const seconds = (ms: number): string => {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return `${String(s)} ${s === 1 ? "second" : "seconds"}`;
};

export function cooldownError(retryAfterMs: number): AppError {
  return new AppError(
    "PROVIDER_COOLDOWN",
    `The AI provider is limiting requests. Try again in ${seconds(retryAfterMs)}.`,
    { retryAfterMs },
  );
}

export function dailyLimitError(): AppError {
  return new AppError("DAILY_LIMIT_REACHED", `Today's generation limit is reached. ${UNCHANGED}.`);
}

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
    case "PROVIDER_RATE_LIMITED":
      return cooldownError(failure.retryAfterMs ?? DEFAULT_COOLDOWN_MS);
    case "DAILY_LIMIT_REACHED":
      return dailyLimitError();
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
      return failure.notSent
        ? new AppError(
            "GATEWAY_UNAVAILABLE",
            `The AI service could not start the request in time. ${UNCHANGED}; try again.`,
          )
        : new AppError(
            "DEADLINE_EXCEEDED",
            `The AI model did not finish in time; the attempt may have been charged. ${UNCHANGED}.`,
          );
    case "AI_OUTCOME_UNKNOWN":
      return new AppError(
        "AI_OUTCOME_UNKNOWN",
        `The AI service did not confirm the result (the connection was lost or no answer arrived in time); the attempt may have been charged. ${UNCHANGED}.`,
      );
    default:
      return assertNever(failure.code, "gateway error code");
  }
}
