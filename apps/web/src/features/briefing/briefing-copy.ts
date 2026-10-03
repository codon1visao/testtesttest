import type { ListSection } from "@event-desk/contracts";

/** The brief's four questions (docs/specs/README.md); "What happened" is overview + summary. */
export const SECTION_COPY = {
  themes: {
    title: "Which themes recur",
    itemLabel: "Theme",
    empty: "No recurring themes identified.",
  },
  conflicts: {
    title: "Where people disagree",
    itemLabel: "Disagreement",
    empty: "No conflicting views identified.",
  },
  suggestions: {
    title: "What might be worth following up",
    itemLabel: "Follow-up",
    empty: "No follow-ups suggested.",
  },
} as const satisfies Record<ListSection, { title: string; itemLabel: string; empty: string }>;

/** F3 "Evidence limits", shown near every briefing. */
export const EVIDENCE_LIMIT_NOTICE =
  "References identify the source notes; they do not automatically prove that the wording is supported. Review the notes before saving.";

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const formatTimestamp = (iso: string): string => timeFormat.format(new Date(iso));
