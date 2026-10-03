import { z } from "zod";
import { normalizeSourceIds } from "./briefing-rules.js";
import type { FeedbackId } from "./ids.js";

/**
 * The model's output schema for one generation (strict Structured Outputs, S1).
 * Objects are closed, every field is required, and `sourceIds` may only name the notes
 * captured for this request. Text bounds and per-section source minimums are deliberately
 * not encoded: they stay in validateEvidenceSections() so this schema uses only the
 * strict-mode subset of JSON Schema. The event backend always revalidates.
 */
export function buildGeneratedSectionsSchema(feedbackIds: readonly FeedbackId[]) {
  const [first, ...rest] = normalizeSourceIds(feedbackIds);
  if (first === undefined) throw new Error("A generation needs at least one feedback note");
  const sourceId = z.enum([first, ...rest]);
  const item = z.strictObject({ text: z.string(), sourceIds: z.array(sourceId) });
  return z.strictObject({
    feedbackSummary: item,
    themes: z.array(item),
    conflicts: z.array(item),
    suggestions: z.array(item),
  });
}

export type GeneratedSections = z.infer<ReturnType<typeof buildGeneratedSectionsSchema>>;
