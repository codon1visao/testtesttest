import { type EventId, EventIdSchema } from "@event-desk/contracts";
import type { z } from "zod";
import { AppError } from "../shared/app-error.js";

/** Parses a request body with a contracts schema; failures become 400 VALIDATION_FAILED. */
export function validateBody<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
): z.output<Schema> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const [issue] = result.error.issues;
  const field =
    issue !== undefined && issue.path.length > 0 ? issue.path.map(String).join(".") : undefined;
  const detail = issue === undefined ? "Invalid request body." : issue.message;
  throw new AppError(
    "VALIDATION_FAILED",
    field === undefined ? detail : `${field}: ${detail}`,
    field === undefined ? {} : { field },
  );
}

/** Route IDs are exact (binary collation): anything malformed is simply an unknown event. */
export function parseEventId(raw: string): EventId {
  const result = EventIdSchema.safeParse(raw);
  if (!result.success) throw new AppError("EVENT_NOT_FOUND", "Event not found.");
  return result.data;
}
