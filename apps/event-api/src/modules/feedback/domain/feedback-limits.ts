import { type FeedbackId, FeedbackIdSchema } from "@event-desk/contracts";

/** S1: 32 KiB of note text keeps generation input within the Gateway limit without truncation. */
export const FEEDBACK_TOTAL_TEXT_MAX_BYTES = 32 * 1024;

export type FeedbackLimitCheck = { ok: true } | { ok: false; reason: "count" | "size" };

const encoder = new TextEncoder();
const bytes = (text: string): number => encoder.encode(text).length;

/** F3 limits for one new note against the event's saved notes. */
export function checkFeedbackLimits(
  existing: readonly { text: string }[],
  text: string,
  maxNotes: number,
): FeedbackLimitCheck {
  if (existing.length + 1 > maxNotes) return { ok: false, reason: "count" };
  const total = existing.reduce((sum, note) => sum + bytes(note.text), bytes(text));
  return total > FEEDBACK_TOTAL_TEXT_MAX_BYTES ? { ok: false, reason: "size" } : { ok: true };
}

/** T4: `F` + at least two digits from events.next_feedback_number. */
export function feedbackIdFor(sequence: number): FeedbackId {
  return FeedbackIdSchema.parse(`F${String(sequence).padStart(2, "0")}`);
}
