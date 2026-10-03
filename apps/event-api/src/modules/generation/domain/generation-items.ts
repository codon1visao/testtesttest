import type { EvidenceSections, FeedbackId } from "@event-desk/contracts";

export const ITEM_SECTIONS = ["summary", "theme", "conflict", "suggestion"] as const;
export type ItemSection = (typeof ITEM_SECTIONS)[number];

export interface NewItem {
  id: string;
  section: ItemSection;
  /** 0-based within its section (T4 uq_item_position; the summary is always 0). */
  position: number;
  text: string;
  /** Citation order as returned; already de-duplicated by validateEvidenceSections. */
  sourceIds: FeedbackId[];
}

/** Flattens validated sections into briefing_items rows in reading order (T4 §5). */
export function toGenerationItems(sections: EvidenceSections, newId: () => string): NewItem[] {
  const list = (section: ItemSection, items: EvidenceSections["themes"]): NewItem[] =>
    items.map((item, position) => ({
      id: newId(),
      section,
      position,
      text: item.text,
      sourceIds: [...item.sourceIds],
    }));
  return [
    ...list("summary", [sections.feedbackSummary]),
    ...list("theme", sections.themes),
    ...list("conflict", sections.conflicts),
    ...list("suggestion", sections.suggestions),
  ];
}
