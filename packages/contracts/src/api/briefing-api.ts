import { z } from "zod";
import { BriefingTextEditsSchema } from "../briefing-content.js";
import { GenerationIdSchema } from "../ids.js";
import { BriefingViewSchema, RevisionSchema } from "./event-view.js";

export const SelectPreviewRequestSchema = z.strictObject({
  generationId: GenerationIdSchema,
  expectedSelectedGenerationId: GenerationIdSchema.nullable(),
});
export type SelectPreviewRequest = z.infer<typeof SelectPreviewRequestSchema>;

export const SelectPreviewResponseSchema = z.strictObject({ selectedPreview: BriefingViewSchema });
export type SelectPreviewResponse = z.infer<typeof SelectPreviewResponseSchema>;

export const SaveBriefingRequestSchema = z.strictObject({
  baseBriefingRevision: RevisionSchema,
  generationId: GenerationIdSchema,
  textEdits: BriefingTextEditsSchema,
});
export type SaveBriefingRequest = z.infer<typeof SaveBriefingRequestSchema>;

export const SaveBriefingResponseSchema = z.strictObject({
  savedBriefing: BriefingViewSchema,
  briefingRevision: RevisionSchema,
  selectedPreview: BriefingViewSchema.nullable(),
});
export type SaveBriefingResponse = z.infer<typeof SaveBriefingResponseSchema>;
