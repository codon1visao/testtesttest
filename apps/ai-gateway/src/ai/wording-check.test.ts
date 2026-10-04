import { FeedbackIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { findWordingProblems } from "./wording-check.js";

const ids = (...raw: string[]) => raw.map((id) => FeedbackIdSchema.parse(id));
const sections = (overrides = {}) => ({
  feedbackSummary: { text: "Notes describe an enjoyable walk.", sourceIds: ids("F01") },
  themes: [{ text: "Two notes ask for longer rest breaks.", sourceIds: ids("F05", "F06") }],
  conflicts: [
    {
      text: "One note asks to start earlier; another note says that would be difficult.",
      sourceIds: ids("F03", "F04"),
    },
  ],
  suggestions: [{ text: "Consider checking the route length.", sourceIds: ids("F07") }],
  ...overrides,
});

describe("findWordingProblems (T3 §4 wording, live smoke aid)", () => {
  it("passes the expected wording", () => {
    expect(findWordingProblems(sections())).toEqual([]);
  });

  it("flags head counts and people-language", () => {
    const problems = findWordingProblems(
      sections({
        conflicts: [
          { text: "Some attendees disagree about the start.", sourceIds: ids("F03", "F04") },
        ],
      }),
    );
    expect(problems).toEqual([
      { section: "conflicts", index: 0, problem: "describes people or a head count" },
    ]);
  });

  it.each(["Participants asked for longer breaks.", "People enjoyed the route."])(
    "flags people-language: %s",
    (text) => {
      expect(
        findWordingProblems(sections({ feedbackSummary: { text, sourceIds: ids("F01", "F02") } })),
      ).toEqual([
        { section: "feedbackSummary", index: 0, problem: "describes people or a head count" },
      ]);
    },
  );

  it("flags 'several notes' in the summary when it cites two notes", () => {
    const problems = findWordingProblems(
      sections({
        feedbackSummary: { text: "Several notes enjoyed the walk.", sourceIds: ids("F01", "F02") },
      }),
    );
    expect(problems).toEqual([
      { section: "feedbackSummary", index: 0, problem: "says several/many/multiple for two notes" },
    ]);
  });

  it("flags 'several notes' for an item citing two notes", () => {
    const problems = findWordingProblems(
      sections({
        themes: [{ text: "Several notes ask for longer breaks.", sourceIds: ids("F05", "F06") }],
      }),
    );
    expect(problems).toEqual([
      { section: "themes", index: 0, problem: "says several/many/multiple for two notes" },
    ]);
  });

  it("flags a suggestion built on the hostile note", () => {
    const problems = findWordingProblems(
      sections({
        suggestions: [{ text: "Consider reviewing attendance records.", sourceIds: ids("F09") }],
      }),
      { hostileNoteId: FeedbackIdSchema.parse("F09") },
    );
    expect(problems).toEqual([
      {
        section: "suggestions",
        index: 0,
        problem: "turns an off-topic or hostile note into a suggestions item",
      },
    ]);
  });

  it.each([
    [
      "feedbackSummary",
      { feedbackSummary: { text: "Notes (F01, F02) enjoyed it.", sourceIds: ids("F01", "F02") } },
    ],
    ["themes", { themes: [{ text: "Longer rest breaks (F05).", sourceIds: ids("F05", "F06") }] }],
    [
      "conflicts",
      {
        conflicts: [
          { text: "F03 asks to start earlier; F04 disagrees.", sourceIds: ids("F03", "F04") },
        ],
      },
    ],
    [
      "suggestions",
      { suggestions: [{ text: "Consider checking the route (F07).", sourceIds: ids("F07") }] },
    ],
  ] as const)("flags a feedback ID written in the %s text", (section, overrides) => {
    expect(findWordingProblems(sections(overrides))).toEqual([
      { section, index: 0, problem: "writes a feedback ID in the text" },
    ]);
  });

  it("does not flag text that only resembles an ID", () => {
    expect(
      findWordingProblems(
        sections({
          suggestions: [{ text: "Consider an F1 route map or a FAQ.", sourceIds: ids("F07") }],
        }),
      ),
    ).toEqual([]);
  });

  it("flags a suggestion longer than 20 words, not one of exactly 20", () => {
    const words = (n: number) =>
      `Consider ${Array.from({ length: n - 1 }, () => "word").join(" ")}.`;
    expect(
      findWordingProblems(sections({ suggestions: [{ text: words(21), sourceIds: ids("F07") }] })),
    ).toEqual([
      { section: "suggestions", index: 0, problem: "suggestion is longer than 20 words" },
    ]);
    expect(
      findWordingProblems(sections({ suggestions: [{ text: words(20), sourceIds: ids("F07") }] })),
    ).toEqual([]);
    // Only suggestions have the length rule.
    expect(
      findWordingProblems(
        sections({ themes: [{ text: `Two notes: ${words(30)}`, sourceIds: ids("F05", "F06") }] }),
      ),
    ).toEqual([]);
  });
});
