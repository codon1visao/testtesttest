import type { z } from "zod";
import { AppError } from "../shared/app-error.js";

/** Every stored row passes a contracts schema; a failure is corruption, never silently repaired (F1). */
export function parseStoredRow<Schema extends z.ZodType>(
  schema: Schema,
  row: unknown,
  table: string,
): z.output<Schema> {
  const result = schema.safeParse(row);
  if (!result.success) {
    throw new AppError(
      "STORE_CORRUPT",
      `Stored ${table} data is invalid. The store needs manual recovery.`,
      {
        cause: result.error,
      },
    );
  }
  return result.data;
}

/** DATETIME(3) columns arrive as Date; anything else is passed through for the schema to reject. */
export function toIsoTimestamp(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}
