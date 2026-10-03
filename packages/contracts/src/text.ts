import { z } from "zod";

/** Length in Unicode code points, matching MySQL CHAR_LENGTH on utf8mb4 columns. */
export function textLength(value: string): number {
  return Array.from(value).length;
}

/**
 * Text that is non-blank after trimming and fits `max` characters as stored.
 * Trimming is for validation only: the parsed value is the original string, and the
 * maximum applies to that stored form so the database never rejects what we accepted.
 */
export function boundedText(max: number) {
  return z
    .string()
    .refine((value) => value.trim().length > 0, { message: "Must not be blank" })
    .refine((value) => textLength(value) <= max, { message: `Must be at most ${max} characters` });
}
