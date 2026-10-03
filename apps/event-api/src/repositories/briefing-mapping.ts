import {
  BriefingContentSchema,
  compareFeedbackIds,
  deriveAttendanceCounts,
  FeedbackIdSchema,
  GenerationProvenanceSchema,
  GenerationTriggerSchema,
  MemberAttendanceSchema,
} from "@event-desk/contracts";
import { z } from "zod";
import type {
  AttendanceInputRow,
  BriefingItemRow,
  BriefingItemSection,
  BriefingItemSourceRow,
  FeedbackInputRow,
  GenerationRow,
} from "../persistence/entities/generation.entities.js";
import type { StoredBriefing } from "../ports/unit-of-work.js";
import { AppError } from "../shared/app-error.js";
import { parseStoredRow, toIsoTimestamp } from "./row-parsing.js";

export interface GenerationRecord {
  generation: GenerationRow;
  attendanceInputs: readonly AttendanceInputRow[];
  feedbackInputs: readonly FeedbackInputRow[];
  items: readonly BriefingItemRow[];
  sources: readonly BriefingItemSourceRow[];
}

/** Human wording from saved_briefings / saved_briefing_items. References stay the generation's (D2). */
export interface SavedWording {
  attendanceOverview: string;
  savedAt: Date;
  itemTexts: ReadonlyMap<string, string>;
}

const SECTION_ORDER: Record<BriefingItemSection, number> = {
  summary: 0,
  theme: 1,
  conflict: 2,
  suggestion: 3,
};

const corrupt = (detail: string) =>
  new AppError(
    "STORE_CORRUPT",
    `Stored briefing is inconsistent (${detail}). The store needs manual recovery.`,
  );

/** Rebuilds BriefingContent and provenance from normalised rows; counts are derived, never stored (T4 §5). */
export function assembleStoredBriefing(
  record: GenerationRecord,
  saved?: SavedWording,
): StoredBriefing {
  const { generation } = record;
  const sourcesByItem = new Map<string, BriefingItemSourceRow[]>();
  for (const source of record.sources) {
    sourcesByItem.set(source.itemId, [...(sourcesByItem.get(source.itemId) ?? []), source]);
  }

  const textOf = (item: BriefingItemRow): string => {
    if (saved === undefined) return item.text;
    const text = saved.itemTexts.get(item.id);
    if (text === undefined) throw corrupt(`no saved wording for item ${item.id}`);
    return text;
  };
  const toEvidence = (item: BriefingItemRow): { text: string; sourceIds: string[] } => ({
    text: textOf(item),
    sourceIds: (sourcesByItem.get(item.id) ?? [])
      .toSorted((a, b) => a.position - b.position)
      .map((source) => source.feedbackId),
  });

  const ordered = record.items.toSorted(
    (a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section] || a.position - b.position,
  );
  const summaries = ordered.filter((item) => item.section === "summary");
  const [summary] = summaries;
  if (summaries.length !== 1 || summary === undefined) {
    throw corrupt(`generation ${generation.id} has ${summaries.length} feedback summaries`);
  }
  const listOf = (section: BriefingItemSection): { text: string; sourceIds: string[] }[] =>
    ordered.filter((item) => item.section === section).map(toEvidence);

  const content = parseStoredRow(
    BriefingContentSchema,
    {
      attendanceOverview: saved?.attendanceOverview ?? generation.attendanceOverview,
      feedbackSummary: toEvidence(summary),
      themes: listOf("theme"),
      conflicts: listOf("conflict"),
      suggestions: listOf("suggestion"),
    },
    "briefing_items",
  );

  const attendance = parseStoredRow(
    z.array(MemberAttendanceSchema),
    record.attendanceInputs.map((row) => ({ memberId: row.memberId, attendance: row.attendance })),
    "generation_attendance_inputs",
  ).toSorted((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0));
  const feedbackIds = parseStoredRow(
    z.array(FeedbackIdSchema),
    record.feedbackInputs.map((row) => row.feedbackId),
    "generation_feedback_inputs",
  ).toSorted(compareFeedbackIds);

  const provenance = parseStoredRow(
    GenerationProvenanceSchema,
    {
      generationId: generation.id,
      runId: generation.runId,
      generatedAt: toIsoTimestamp(generation.generatedAt),
      model: generation.model,
      promptVersion: generation.promptVersion,
      input: {
        attendance,
        counts: deriveAttendanceCounts(attendance),
        feedbackIds,
        feedbackDigest: generation.feedbackDigest,
      },
    },
    "briefing_generations",
  );

  return {
    provenance,
    trigger: parseStoredRow(
      GenerationTriggerSchema,
      generation.triggerType,
      "briefing_generations",
    ),
    content,
    ...(saved === undefined ? {} : { savedAt: saved.savedAt.toISOString() }),
  };
}
