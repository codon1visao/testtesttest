import { AppError } from "../shared/app-error.js";

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "ER_CON_COUNT_ERROR",
  "ER_SERVER_SHUTDOWN",
]);

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("driverError" in error) return errorCode(error.driverError);
  return undefined;
}

export function isConnectionError(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && CONNECTION_ERROR_CODES.has(code);
}

export function storeUnavailable(cause: unknown): AppError {
  return new AppError("STORE_UNAVAILABLE", "The event store is unavailable. Try again shortly.", {
    cause,
  });
}

/** Database failures become typed errors: connection loss is 503, anything else is 500. */
export function toStoreError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (isConnectionError(error)) return storeUnavailable(error);
  return new AppError("INTERNAL", "The event store could not complete the request.", {
    cause: error,
  });
}
