export const MYSQL_ERRNO = {
  duplicateEntry: 1062,
  noReferencedRow: 1452,
  rowIsReferenced: 1451,
  checkConstraintViolated: 3819,
} as const;

function errnoOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("errno" in error && typeof error.errno === "number") return error.errno;
  if ("driverError" in error) return errnoOf(error.driverError);
  return undefined;
}

export function isDuplicateKeyError(error: unknown): boolean {
  return errnoOf(error) === MYSQL_ERRNO.duplicateEntry;
}

/** The mysql2 error code (`ER_LOCK_WAIT_TIMEOUT`, `ECONNREFUSED`, …), also through TypeORM's wrapper. */
export function driverErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("driverError" in error) return driverErrorCode(error.driverError);
  return undefined;
}

/** mysql2's per-query `timeout` fired (the connection is still busy: see pooled-connection.ts). */
export function isQueryTimeout(error: unknown): boolean {
  return driverErrorCode(error) === "PROTOCOL_SEQUENCE_TIMEOUT";
}
