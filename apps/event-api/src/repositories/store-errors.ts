import { driverErrorCode } from "../persistence/mysql-errors.js";
import { AppError } from "../shared/app-error.js";

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "PROTOCOL_CONNECTION_LOST",
  "ER_CON_COUNT_ERROR",
  "ER_SERVER_SHUTDOWN",
]);

/** Lock waits, deadlocks and mysql2's per-query timeout: the store is up but cannot answer in time. */
const BUSY_ERROR_CODES = new Set([
  "ER_LOCK_WAIT_TIMEOUT", // 1205
  "ER_LOCK_DEADLOCK", // 1213
  "PROTOCOL_SEQUENCE_TIMEOUT", // mysql2 `timeout` (MYSQL_QUERY_TIMEOUT_MS)
]);

export function isConnectionError(error: unknown): boolean {
  const code = driverErrorCode(error);
  return code !== undefined && CONNECTION_ERROR_CODES.has(code);
}

export function isBusyError(error: unknown): boolean {
  const code = driverErrorCode(error);
  return code !== undefined && BUSY_ERROR_CODES.has(code);
}

export function storeUnavailable(cause: unknown): AppError {
  return new AppError("STORE_UNAVAILABLE", "The event store is unavailable. Try again shortly.", {
    cause,
  });
}

export function storeBusy(cause: unknown): AppError {
  return new AppError("STORE_UNAVAILABLE", "The event store is busy. Try again shortly.", {
    cause,
  });
}

/** Database failures become typed errors: connection loss and timeouts are 503, anything else is 500. */
export function toStoreError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (isConnectionError(error)) return storeUnavailable(error);
  if (isBusyError(error)) return storeBusy(error);
  return new AppError("INTERNAL", "The event store could not complete the request.", {
    cause: error,
  });
}
