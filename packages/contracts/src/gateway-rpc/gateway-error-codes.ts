import { z } from "zod";
import type { ErrorCode } from "../api/errors.js";

/**
 * Codes the Gateway may return (F8). A subset of the application codes, so the event backend maps
 * them without translation tables; whether a code is retryable is the caller's policy, not ours.
 */
export const GATEWAY_ERROR_CODES = [
  "GATEWAY_AUTH_FAILED",
  "VALIDATION_FAILED",
  "GATEWAY_UNAVAILABLE",
  "DEADLINE_EXCEEDED",
  "DAILY_LIMIT_REACHED",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_TEMPORARY",
  "PROVIDER_REFUSED",
  "OUTPUT_INCOMPLETE",
  "OUTPUT_INVALID",
  "AI_OUTCOME_UNKNOWN",
  "INTERNAL",
] as const satisfies readonly ErrorCode[];

export const GatewayErrorCodeSchema = z.enum(GATEWAY_ERROR_CODES);
export type GatewayErrorCode = z.infer<typeof GatewayErrorCodeSchema>;
