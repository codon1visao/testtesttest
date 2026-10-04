import type { ListSection } from "@event-desk/contracts";

/**
 * Section names for the brief's four questions (docs/specs/README.md), kept short: "Summary" is the
 * overview and feedback summary, then themes, disagreements and suggestions for the coordinator.
 */
export const SECTION_COPY = {
  themes: {
    title: "Themes",
    itemLabel: "Theme",
    empty: "No recurring themes identified.",
  },
  conflicts: {
    title: "Disagreements",
    itemLabel: "Disagreement",
    empty: "No conflicting views identified.",
  },
  suggestions: {
    title: "Suggestions for you",
    itemLabel: "Suggestion",
    empty: "No suggestions.",
  },
} as const satisfies Record<ListSection, { title: string; itemLabel: string; empty: string }>;

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const formatTimestamp = (iso: string): string => timeFormat.format(new Date(iso));
