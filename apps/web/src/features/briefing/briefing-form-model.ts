import {
  boundedText,
  type BriefingContent,
  type BriefingView,
  type EventView,
  type GenerationId,
  LIST_SECTIONS,
  type ListSection,
  type SaveBriefingRequest,
  TEXT_LIMITS,
} from "@event-desk/contracts";
import { type FieldErrors, get } from "react-hook-form";
import { z } from "zod";
import type { ActiveView } from "../../state/ui-store";
import { activeBriefing, type EditableSlot } from "./active-briefing";

const itemText = z.object({ text: boundedText(TEXT_LIMITS.item) });

/** Wording only (D2): one field per stored item; there is nothing to add, remove or reorder. */
export const BriefingFormSchema = z.object({
  attendanceOverview: boundedText(TEXT_LIMITS.attendanceOverview),
  feedbackSummary: boundedText(TEXT_LIMITS.feedbackSummary),
  themes: z.array(itemText),
  conflicts: z.array(itemText),
  suggestions: z.array(itemText),
});
export type BriefingFormValues = z.input<typeof BriefingFormSchema>;
export type BriefingFormOutput = z.output<typeof BriefingFormSchema>;
export type BriefingFieldPath =
  "attendanceOverview" | "feedbackSummary" | `${ListSection}.${number}.text`;

export function toFormValues(content: BriefingContent): BriefingFormOutput {
  const texts = (section: ListSection) => content[section].map((item) => ({ text: item.text }));
  return {
    attendanceOverview: content.attendanceOverview,
    feedbackSummary: content.feedbackSummary.text,
    themes: texts("themes"),
    conflicts: texts("conflicts"),
    suggestions: texts("suggestions"),
  };
}

export function toSaveRequest(
  values: BriefingFormOutput,
  generationId: GenerationId,
  baseBriefingRevision: number,
): SaveBriefingRequest {
  const texts = (section: ListSection) => values[section].map((item) => item.text);
  return {
    baseBriefingRevision,
    generationId,
    textEdits: {
      attendanceOverview: values.attendanceOverview,
      feedbackSummary: values.feedbackSummary,
      themes: texts("themes"),
      conflicts: texts("conflicts"),
      suggestions: texts("suggestions"),
    },
  };
}

/** After a lost response: does the saved briefing now hold exactly this draft for this generation? */
export function draftMatchesSaved(
  values: BriefingFormValues,
  generationId: GenerationId,
  saved: BriefingView | null,
): boolean {
  if (saved?.provenance.generationId !== generationId) return false;
  const content = saved.content;
  return (
    content.attendanceOverview === values.attendanceOverview &&
    content.feedbackSummary.text === values.feedbackSummary &&
    LIST_SECTIONS.every(
      (section) =>
        content[section].length === values[section].length &&
        content[section].every((item, index) => item.text === values[section][index]?.text),
    )
  );
}

const ITEM_FIELD = /^textEdits\.(themes|conflicts|suggestions)\.(\d+)$/;

/** "textEdits.conflicts.0" → "conflicts.0.text"; a section-level field has no single input. */
export function formFieldForApiField(field: string | undefined): BriefingFieldPath | null {
  if (field === "textEdits.attendanceOverview") return "attendanceOverview";
  if (field === "textEdits.feedbackSummary") return "feedbackSummary";
  const match = field === undefined ? null : ITEM_FIELD.exec(field);
  const section = LIST_SECTIONS.find((name) => name === match?.[1]);
  return section === undefined || match?.[2] === undefined
    ? null
    : `${section}.${Number(match[2])}.text`;
}

/** The editor's fields in screen order: the summary card first, then each section's items. */
function fieldPaths(values: BriefingFormValues): BriefingFieldPath[] {
  return [
    "feedbackSummary",
    "attendanceOverview",
    ...LIST_SECTIONS.flatMap((section) =>
      values[section].map((_, index): BriefingFieldPath => `${section}.${index}.text`),
    ),
  ];
}

/** The first field with an error, so a save started from the read view can open on it. */
export function firstErrorField(
  errors: FieldErrors<BriefingFormValues>,
  values: BriefingFormValues,
): BriefingFieldPath | null {
  return (
    fieldPaths(values).find((path) => {
      const error: unknown = get(errors, path);
      return error !== undefined;
    }) ?? null
  );
}

export interface EditorBase {
  slot: EditableSlot;
  briefing: BriefingView;
  briefingRevision: number;
}

export function toEditorBase(view: EventView, activeView: ActiveView): EditorBase | null {
  const active = activeBriefing(view, activeView);
  return active === null ? null : { ...active, briefingRevision: view.briefingRevision };
}

/** T3 §11: a draft belongs to one slot, generation and briefing revision. */
export function editorKey(base: EditorBase | null): string {
  return base === null
    ? "none"
    : `${base.slot}:${base.briefing.provenance.generationId}:${String(base.briefingRevision)}`;
}
