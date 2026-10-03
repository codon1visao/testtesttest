import {
  type BriefingContent,
  type EvidenceItem,
  type ListSection,
  SECTION_LIMITS,
  TEXT_LIMITS,
} from "./briefing-content.js";
import type { FeedbackId } from "./ids.js";
import { boundedText } from "./text.js";

export type EvidenceSectionKey = "feedbackSummary" | ListSection;

/** Minimum distinct notes per item (T3 §4): a pattern or a disagreement needs two notes. */
export const MIN_DISTINCT_SOURCES = {
  feedbackSummary: 1,
  themes: 2,
  conflicts: 2,
  suggestions: 1,
} as const satisfies Record<EvidenceSectionKey, number>;

/** Unverified input, e.g. a model candidate: source IDs are plain strings until checked. */
export interface RawEvidenceItem {
  readonly text: string;
  readonly sourceIds: readonly string[];
}
export interface RawEvidenceSections {
  feedbackSummary: RawEvidenceItem;
  themes: readonly RawEvidenceItem[];
  conflicts: readonly RawEvidenceItem[];
  suggestions: readonly RawEvidenceItem[];
}
export type EvidenceSections = Pick<BriefingContent, EvidenceSectionKey>;

export type EvidenceIssueCode =
  "TOO_MANY_ITEMS" | "TEXT_INVALID" | "UNKNOWN_SOURCE" | "TOO_FEW_SOURCES" | "TOO_MANY_SOURCES";

export interface EvidenceIssue {
  section: EvidenceSectionKey;
  /** Item position, or null for a section-level issue. */
  index: number | null;
  code: EvidenceIssueCode;
  message: string;
}

export type EvidenceValidation =
  { ok: true; sections: EvidenceSections } | { ok: false; issues: EvidenceIssue[] };

/** Drops repeated IDs, keeping first-occurrence order (F4 rule 4). */
export function normalizeSourceIds<T extends string>(ids: readonly T[]): T[] {
  return [...new Set(ids)];
}

/**
 * Structural evidence checks shared by generation and saving (F4 rules 2-5, D12, D16).
 * Every cited ID must belong to the generation's captured input; any failure rejects the
 * whole candidate. This proves which notes are cited, not that the wording is supported.
 */
export function validateEvidenceSections(
  sections: RawEvidenceSections,
  inputFeedbackIds: readonly FeedbackId[],
): EvidenceValidation {
  const allowed = new Set<string>(inputFeedbackIds);
  const isCaptured = (id: string): id is FeedbackId => allowed.has(id);
  const issues: EvidenceIssue[] = [];

  const checkItem = (
    section: EvidenceSectionKey,
    index: number,
    item: RawEvidenceItem,
    maxText: number,
  ): EvidenceItem | undefined => {
    const before = issues.length;
    const report = (code: EvidenceIssueCode, message: string) =>
      issues.push({ section, index, code, message });

    if (!boundedText(maxText).safeParse(item.text).success) {
      report("TEXT_INVALID", `Text must be 1-${maxText} characters and not blank`);
    }
    const ids = normalizeSourceIds(item.sourceIds);
    const unknown = ids.filter((id) => !isCaptured(id));
    if (unknown.length > 0) {
      report("UNKNOWN_SOURCE", `Not in this generation's input: ${unknown.join(", ")}`);
    }
    const minimum = MIN_DISTINCT_SOURCES[section];
    if (ids.length < minimum) {
      report("TOO_FEW_SOURCES", `Needs at least ${minimum} distinct notes, got ${ids.length}`);
    }
    if (ids.length > SECTION_LIMITS.sourcesPerItem) {
      report("TOO_MANY_SOURCES", `At most ${SECTION_LIMITS.sourcesPerItem} distinct notes`);
    }
    return issues.length === before
      ? { text: item.text, sourceIds: ids.filter(isCaptured) }
      : undefined;
  };

  const checkList = (section: ListSection): EvidenceItem[] => {
    const items = sections[section];
    if (items.length > SECTION_LIMITS.itemsPerSection) {
      issues.push({
        section,
        index: null,
        code: "TOO_MANY_ITEMS",
        message: `At most ${SECTION_LIMITS.itemsPerSection} items`,
      });
      return [];
    }
    return items.flatMap((item, index) => checkItem(section, index, item, TEXT_LIMITS.item) ?? []);
  };

  const feedbackSummary = checkItem(
    "feedbackSummary",
    0,
    sections.feedbackSummary,
    TEXT_LIMITS.feedbackSummary,
  );
  const themes = checkList("themes");
  const conflicts = checkList("conflicts");
  const suggestions = checkList("suggestions");

  if (issues.length > 0 || feedbackSummary === undefined) return { ok: false, issues };
  return { ok: true, sections: { feedbackSummary, themes, conflicts, suggestions } };
}
