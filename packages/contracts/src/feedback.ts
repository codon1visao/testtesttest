import { z } from "zod";
import { FeedbackIdSchema, type FeedbackId } from "./ids.js";
import { boundedText } from "./text.js";

export const FEEDBACK_TEXT_MAX = 1000;
export const FeedbackTextSchema = boundedText(FEEDBACK_TEXT_MAX);

/** An anonymous note: deliberately no member or identity field (brief, F3). */
export const FeedbackNoteSchema = z.strictObject({
  id: FeedbackIdSchema,
  text: FeedbackTextSchema,
  receivedAt: z.iso.datetime(),
});
export type FeedbackNote = z.infer<typeof FeedbackNoteSchema>;

function feedbackNumber(id: FeedbackId): number {
  return Number.parseInt(id.slice(1), 10);
}

/**
 * Numeric order (F09 < F11 < F100); lexical order would put F100 before F11. IDs with equal
 * numbers (F01, F001) fall back to code-unit order so the result is a total order and the
 * digest cannot depend on input order.
 */
export function compareFeedbackIds(a: FeedbackId, b: FeedbackId): number {
  const byNumber = feedbackNumber(a) - feedbackNumber(b);
  if (byNumber !== 0) return byNumber;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * SHA-256 of the canonical `[[id, text], …]` list in numeric ID order, as lowercase hex.
 * Order-independent so callers need not agree on a sort. Uses Web Crypto, which Node 24
 * and browsers both provide, keeping this package isomorphic.
 */
export async function feedbackDigest(
  notes: readonly Pick<FeedbackNote, "id" | "text">[],
): Promise<string> {
  const canonical = JSON.stringify(
    notes.toSorted((a, b) => compareFeedbackIds(a.id, b.id)).map((note) => [note.id, note.text]),
  );
  const hash = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
