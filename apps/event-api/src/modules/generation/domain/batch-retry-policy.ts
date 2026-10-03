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
