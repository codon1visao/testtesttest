import { ApiErrorBodySchema, type HttpErrorCode } from "@event-desk/contracts";

/** Parses a JSON error response through the contract, so tests never touch `any` bodies. */
export function errorCodeOf(response: { body: unknown }): HttpErrorCode {
  return ApiErrorBodySchema.parse(response.body).error.code;
}
