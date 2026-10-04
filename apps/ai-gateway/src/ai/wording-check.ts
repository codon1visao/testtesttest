import type { FeedbackId } from "@event-desk/contracts";

interface Item {
  text: string;
  sourceIds: readonly string[];
}

export interface SectionsLike {
  feedbackSummary: Item;
  themes: readonly Item[];
  conflicts: readonly Item[];
  suggestions: readonly Item[];
}

export interface WordingFinding {
  section: "feedbackSummary" | "themes" | "conflicts" | "suggestions";
  index: number;
  problem: string;
}

const PEOPLE =
  /\bsome attendees\b|\bpeople\b|\bparticipants?\b|\beveryone\b|\bhalf the group\b|\b(members|attendees) (disagree|differ)/i;
const VAGUE_TWO = /\b(several|many|multiple) notes\b/i;
const FEEDBACK_ID = /\bF\d{2,}\b/;
const SUGGESTION_MAX_WORDS = 20;
const wordCount = (text: string) => text.split(/\s+/).filter((word) => word !== "").length;

/**
 * A review aid for the manual live smoke test, not a production filter (S1): keyword stripping is
 * never the defence. The wording rules live in the prompt and in human review.
 */
export function findWordingProblems(
  sections: SectionsLike,
  options: { hostileNoteId?: FeedbackId } = {},
): WordingFinding[] {
  const findings: WordingFinding[] = [];
  const check = (section: WordingFinding["section"], items: readonly Item[]) => {
    items.forEach((item, index) => {
      if (PEOPLE.test(item.text)) {
        findings.push({ section, index, problem: "describes people or a head count" });
      }
      if (new Set(item.sourceIds).size === 2 && VAGUE_TWO.test(item.text)) {
        findings.push({ section, index, problem: "says several/many/multiple for two notes" });
      }
      if (FEEDBACK_ID.test(item.text)) {
        findings.push({ section, index, problem: "writes a feedback ID in the text" });
      }
      if (section === "suggestions" && wordCount(item.text) > SUGGESTION_MAX_WORDS) {
        findings.push({ section, index, problem: "suggestion is longer than 20 words" });
      }
      if (
        section !== "feedbackSummary" &&
        options.hostileNoteId !== undefined &&
        item.sourceIds.includes(options.hostileNoteId)
      ) {
        findings.push({
          section,
          index,
          problem: `turns an off-topic or hostile note into a ${section} item`,
        });
      }
    });
  };
  check("feedbackSummary", [sections.feedbackSummary]);
  check("themes", sections.themes);
  check("conflicts", sections.conflicts);
  check("suggestions", sections.suggestions);
  return findings;
}
