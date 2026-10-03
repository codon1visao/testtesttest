import {
  type BriefingTextEdits,
  boundedText,
  type EvidenceIssue,
  type FeedbackId,
  type RawEvidenceItem,
  TEXT_LIMITS,
  validateEvidenceSections,
} from "@event-desk/contracts";
import type { ItemSection, NewItem } from "../../generation/domain/generation-items.js";

/** What a stored generation fixes and an edit may not touch: item IDs, order and sources. */
export interface EditableStructure {
  feedbackIds: readonly FeedbackId[];
  /**
   * Precondition: ordered by section, then by position within the section (the order
   * `GenerationWriteRepository.structure()` returns). Text positions are matched to items in this order.
   */
  items: readonly NewItem[];
}

export interface EditedWording {
  attendanceOverview: string;
  /** briefing_items.id → the text exactly as typed (trimmed only to validate). */
  itemTexts: ReadonlyMap<string, string>;
}

export type TextEditResult =
  | { ok: true; wording: EditedWording }
  | { ok: false; code: "CONTENT_INVALID" | "REFERENCE_INVALID"; field: string; message: string };

type TextSection = Exclude<keyof BriefingTextEdits, "attendanceOverview">;

/** Reading order; each text section edits exactly the stored items of one item section. */
const TEXT_SECTIONS = [
  ["feedbackSummary", "summary"],
  ["themes", "theme"],
  ["conflicts", "conflict"],
  ["suggestions", "suggestion"],
] as const satisfies readonly (readonly [TextSection, ItemSection])[];

const textsOf = (edits: BriefingTextEdits, section: TextSection): readonly string[] =>
  section === "feedbackSummary" ? [edits.feedbackSummary] : edits[section];

const fieldOf = (issue: EvidenceIssue): string =>
  issue.section === "feedbackSummary" || issue.index === null
    ? `textEdits.${issue.section}`
    : `textEdits.${issue.section}.${String(issue.index)}`;

/**
 * D2/F5: a save changes wording only. Each position updates its stored item's text; item count,
 * order and sources come from the stored generation and are re-validated, never taken from the
 * client and never repaired.
 */
export function applyTextEdits(
  structure: EditableStructure,
  edits: BriefingTextEdits,
): TextEditResult {
  const paired = new Map<TextSection, { item: NewItem; text: string }[]>();
  for (const [textSection, itemSection] of TEXT_SECTIONS) {
    const stored = structure.items.filter((item) => item.section === itemSection);
    const texts = textsOf(edits, textSection);
    if (texts.length !== stored.length) {
      return {
        ok: false,
        code: "CONTENT_INVALID",
        field: `textEdits.${textSection}`,
        message: `Expected ${String(stored.length)} items, got ${String(texts.length)}.`,
      };
    }
    paired.set(
      textSection,
      stored.map((item, index) => ({ item, text: texts[index] ?? "" })),
    );
  }

  if (!boundedText(TEXT_LIMITS.attendanceOverview).safeParse(edits.attendanceOverview).success) {
    return {
      ok: false,
      code: "CONTENT_INVALID",
      field: "textEdits.attendanceOverview",
      message: `The attendance overview must be 1-${String(TEXT_LIMITS.attendanceOverview)} characters and not blank.`,
    };
  }

  const raw = (section: TextSection): RawEvidenceItem[] =>
    (paired.get(section) ?? []).map(({ item, text }) => ({ text, sourceIds: item.sourceIds }));
  const [summary] = raw("feedbackSummary");
  if (summary === undefined) {
    // Unreachable after the count check (one summary string ⇔ one stored summary item).
    return {
      ok: false,
      code: "REFERENCE_INVALID",
      field: "textEdits.feedbackSummary",
      message: "The stored summary item is missing.",
    };
  }
  const validation = validateEvidenceSections(
    {
      feedbackSummary: summary,
      themes: raw("themes"),
      conflicts: raw("conflicts"),
      suggestions: raw("suggestions"),
    },
    structure.feedbackIds,
  );
  if (!validation.ok) {
    const reference = validation.issues.find((issue) => issue.code !== "TEXT_INVALID");
    if (reference !== undefined) {
      return {
        ok: false,
        code: "REFERENCE_INVALID",
        field: `textEdits.${reference.section}`,
        message: `The stored references for this item are invalid (${reference.message}). The briefing cannot be saved; generate a new one.`,
      };
    }
    const [text] = validation.issues;
    return {
      ok: false,
      code: "CONTENT_INVALID",
      field: text === undefined ? "textEdits" : fieldOf(text),
      message: text?.message ?? "The briefing text is invalid.",
    };
  }

  const itemTexts = new Map<string, string>();
  for (const pairs of paired.values())
    for (const { item, text } of pairs) itemTexts.set(item.id, text);
  return { ok: true, wording: { attendanceOverview: edits.attendanceOverview, itemTexts } };
}

/** True when saving `wording` for `generationId` would change nothing (F5: no-op, no new revision). */
export function sameAsSaved(
  saved: {
    generationId: string;
    attendanceOverview: string;
    itemTexts: ReadonlyMap<string, string>;
  } | null,
  generationId: string,
  wording: EditedWording,
): boolean {
  if (saved?.generationId !== generationId) return false;
  if (saved.attendanceOverview !== wording.attendanceOverview) return false;
  if (saved.itemTexts.size !== wording.itemTexts.size) return false;
  return [...wording.itemTexts].every(([itemId, text]) => saved.itemTexts.get(itemId) === text);
}
