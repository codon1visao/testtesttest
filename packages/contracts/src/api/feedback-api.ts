import { z } from "zod";
import { FeedbackNoteSchema, FeedbackTextSchema } from "../feedback.js";

export const SubmitFeedbackRequestSchema = z.strictObject({
  submissionId: z.uuid(),
  text: FeedbackTextSchema,
});
export type SubmitFeedbackRequest = z.infer<typeof SubmitFeedbackRequestSchema>;

export const AUTOMATIC_BRIEFING_SCHEDULING = ["scheduled", "deferred"] as const;

export const SubmitFeedbackResponseSchema = z.strictObject({
  note: FeedbackNoteSchema,
  automaticBriefing: z.enum(AUTOMATIC_BRIEFING_SCHEDULING),
});
export type SubmitFeedbackResponse = z.infer<typeof SubmitFeedbackResponseSchema>;
