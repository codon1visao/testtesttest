import { z } from "zod";
import { FeedbackIdSchema } from "./ids.js";
import { boundedText } from "./text.js";

export const TEXT_LIMITS = { attendanceOverview: 500, feedbackSummary: 600, item: 1000 } as const;
export const SECTION_LIMITS = { itemsPerSection: 10, sourcesPerItem: 8 } as const;

/** Positioned item sections. "What happened" is attendanceOverview + feedbackSummary (D16). */
export const LIST_SECTIONS = ["themes", "conflicts", "suggestions"] as const;
export type ListSection = (typeof LIST_SECTIONS)[number];

const sourceIds = z.array(FeedbackIdSchema).min(1).max(SECTION_LIMITS.sourcesPerItem);

export const EvidenceItemSchema = z.strictObject({
  text: boundedText(TEXT_LIMITS.item),
  sourceIds,
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const FeedbackSummarySchema = z.strictObject({
  text: boundedText(TEXT_LIMITS.feedbackSummary),
  sourceIds,
});

const itemList = z.array(EvidenceItemSchema).max(SECTION_LIMITS.itemsPerSection);

/** The read/stored shape. Section-specific source minimums live in briefing-rules.ts. */
export const BriefingContentSchema = z.strictObject({
  attendanceOverview: boundedText(TEXT_LIMITS.attendanceOverview),
  feedbackSummary: FeedbackSummarySchema,
  themes: itemList,
  conflicts: itemList,
  suggestions: itemList,
});
export type BriefingContent = z.infer<typeof BriefingContentSchema>;

const textList = z.array(boundedText(TEXT_LIMITS.item)).max(SECTION_LIMITS.itemsPerSection);

/** The text-only save payload (D2): wording by section and position, never sources. */
export const BriefingTextEditsSchema = z.strictObject({
  attendanceOverview: boundedText(TEXT_LIMITS.attendanceOverview),
  feedbackSummary: boundedText(TEXT_LIMITS.feedbackSummary),
  themes: textList,
  conflicts: textList,
  suggestions: textList,
});
export type BriefingTextEdits = z.infer<typeof BriefingTextEditsSchema>;
