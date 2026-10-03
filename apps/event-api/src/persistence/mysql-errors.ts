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
