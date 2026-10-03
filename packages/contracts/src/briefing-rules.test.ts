import { describe, expect, it } from "vitest";
import {
  normalizeSourceIds,
  type RawEvidenceItem,
  type RawEvidenceSections,
  validateEvidenceSections,
} from "./briefing-rules.js";
import { FeedbackIdSchema } from "./ids.js";

const INPUT = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"].map((id) =>
  FeedbackIdSchema.parse(id),
);
const item = (text: string, ...sourceIds: string[]): RawEvidenceItem => ({ text, sourceIds });

/** A faithful briefing for the supplied notes (F4 "Expected interpretation"). */
function validSections(): RawEvidenceSections {
  return {
    feedbackSummary: item(
      "Feedback describes the walk as enjoyable, with comments mostly about logistics.",
      "F01",
      "F02",
      "F03",
      "F04",
      "F05",
      "F06",
      "F07",
      "F08",
    ),
    themes: [item("Requests for more rest-break time.", "F05", "F06")],
    conflicts: [
      item("One note found the meeting point hard to find; another had no trouble.", "F01", "F02"),
      item("One note asks for an earlier start; another says it would be difficult.", "F03", "F04"),
    ],
    suggestions: [
      item("Consider asking about start-time constraints before changing it.", "F03", "F04"),
      item("Consider reviewing the route length.", "F07"),
    ],
  };
}

const codesOf = (sections: RawEvidenceSections) => {
  const result = validateEvidenceSections(sections, INPUT);
  return result.ok ? [] : result.issues.map((i) => `${i.section}[${i.index ?? "-"}]:${i.code}`);
};

describe("normalizeSourceIds", () => {
  it("removes repeats and keeps first-occurrence order", () => {
    expect(normalizeSourceIds(["F06", "F05", "F06"])).toEqual(["F06", "F05"]);
  });
});

describe("validateEvidenceSections", () => {
  it("accepts a faithful briefing and returns normalized, typed sections", () => {
    const sections = validSections();
    sections.themes = [item("Requests for more rest-break time.", "F05", "F06", "F05")];
    const result = validateEvidenceSections(sections, INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sections.themes[0]?.sourceIds).toEqual(["F05", "F06"]);
  });

  it("accepts an empty themes section: there is no theme quota (F4-14)", () => {
    expect(codesOf({ ...validSections(), themes: [] })).toEqual([]);
  });

  it("rejects a theme with one note or one note repeated (F4-12)", () => {
    expect(codesOf({ ...validSections(), themes: [item("Rest", "F05")] })).toEqual([
      "themes[0]:TOO_FEW_SOURCES",
    ]);
    expect(codesOf({ ...validSections(), themes: [item("Rest", "F05", "F05")] })).toEqual([
      "themes[0]:TOO_FEW_SOURCES",
    ]);
  });

  it("rejects a conflict that cites only one side (F4-15, D12)", () => {
    const sections = { ...validSections(), conflicts: [item("Start time differs.", "F03", "F03")] };
    expect(codesOf(sections)).toEqual(["conflicts[0]:TOO_FEW_SOURCES"]);
  });

  it("allows a single-note suggestion and requires a cited summary", () => {
    expect(codesOf({ ...validSections(), feedbackSummary: item("Summary.") })).toEqual([
      "feedbackSummary[0]:TOO_FEW_SOURCES",
    ]);
  });

  it("rejects the whole candidate for an unknown ID instead of stripping it (F4-04)", () => {
    const sections = { ...validSections(), themes: [item("Rest", "F05", "F05", "F99")] };
    const result = validateEvidenceSections(sections, INPUT);
    expect(result.ok).toBe(false);
    expect(codesOf(sections)).toEqual(["themes[0]:UNKNOWN_SOURCE"]);
  });

  it("rejects a note that was not in this generation's captured input", () => {
    const sections = { ...validSections(), suggestions: [item("Follow up.", "F09")] };
    expect(codesOf(sections)).toEqual(["suggestions[0]:UNKNOWN_SOURCE"]);
  });

  it("enforces text and size bounds without truncating", () => {
    const tooManyThemes = Array.from({ length: 11 }, () => item("Rest", "F05", "F06"));
    expect(codesOf({ ...validSections(), themes: tooManyThemes })).toEqual([
      "themes[-]:TOO_MANY_ITEMS",
    ]);
    expect(codesOf({ ...validSections(), themes: [item("  ", "F05", "F06")] })).toEqual([
      "themes[0]:TEXT_INVALID",
    ]);
    expect(codesOf({ ...validSections(), feedbackSummary: item("x".repeat(601), "F01") })).toEqual([
      "feedbackSummary[0]:TEXT_INVALID",
    ]);
  });

  it("rejects more than eight distinct sources on one item", () => {
    const nine = [...INPUT.map(String), "F09"];
    const result = validateEvidenceSections(
      { ...validSections(), suggestions: [item("Too many.", ...nine)] },
      [...INPUT, FeedbackIdSchema.parse("F09")],
    );
    expect(result.ok ? [] : result.issues.map((i) => i.code)).toEqual(["TOO_MANY_SOURCES"]);
  });
});
