import { z } from "zod";
import { BriefingViewSchema, RevisionSchema } from "./event-view.js";

/** Generate and Retry send only the attendance baseline: never prompts or source text. */
export const GenerateBriefingRequestSchema = z.strictObject({
  baseAttendanceRevision: RevisionSchema,
});
export type GenerateBriefingRequest = z.infer<typeof GenerateBriefingRequestSchema>;

export const GenerateBriefingResponseSchema = z.strictObject({
  incomingPreview: BriefingViewSchema,
});
export type GenerateBriefingResponse = z.infer<typeof GenerateBriefingResponseSchema>;
