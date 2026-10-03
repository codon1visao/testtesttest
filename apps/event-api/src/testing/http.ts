import { ApiErrorBodySchema, type ErrorCode } from "@event-desk/contracts";

/** Parses a JSON error response through the contract, so tests never touch `any` bodies. */
export function errorCodeOf(response: { body: unknown }): ErrorCode {
  return ApiErrorBodySchema.parse(response.body).error.code;
}
