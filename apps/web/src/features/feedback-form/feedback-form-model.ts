import { FEEDBACK_TEXT_MAX, textLength } from "@event-desk/contracts";

export type FeedbackDraftProblem = "blank" | "too-long" | null;

/** The same rules as the API (F3): trimmed only to validate; the text is sent as written. */
export function feedbackDraftProblem(text: string): FeedbackDraftProblem {
  if (text.trim().length === 0) return "blank";
  return textLength(text) > FEEDBACK_TEXT_MAX ? "too-long" : null;
}

export const DRAFT_PROBLEM_TEXT = {
  blank: "Write some feedback before submitting.",
  "too-long": "Feedback must be at most 1,000 characters.",
} as const;
