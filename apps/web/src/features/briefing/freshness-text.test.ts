import {
  FeedbackIdSchema,
  MemberIdSchema,
  SUPPLIED_MEMBERS,
  type Freshness,
} from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { attendanceChangeLines, freshnessTitle, newNotesLine } from "./freshness-text";

const CURRENT: Freshness = { current: true, attendanceChanges: [], newFeedbackIds: [] };
const ATTENDANCE: Freshness = {
  current: false,
  attendanceChanges: [
    { memberId: MemberIdSchema.parse("M03"), from: "not_recorded", to: "attended" },
  ],
  newFeedbackIds: [FeedbackIdSchema.parse("F09"), FeedbackIdSchema.parse("F10")],
};
const NOTES_ONLY: Freshness = {
  current: false,
  attendanceChanges: [],
  newFeedbackIds: [FeedbackIdSchema.parse("F09")],
};

describe("freshness text (D5, F6)", () => {
  it("titles: attendance first, then notes; nothing when current", () => {
    expect(freshnessTitle(CURRENT)).toBeNull();
    expect(freshnessTitle(ATTENDANCE)).toBe(
      "Out of date — attendance changed since this briefing was generated",
    );
    expect(freshnessTitle(NOTES_ONLY)).toBe(
      "Out of date — new feedback since this briefing was generated",
    );
  });

  it("names members and their change", () => {
    expect(attendanceChangeLines(ATTENDANCE, SUPPLIED_MEMBERS)).toEqual([
      "Chris: Not recorded → Attended",
    ]);
  });

  it("lists new notes with a correct plural", () => {
    expect(newNotesLine(ATTENDANCE)).toBe("2 new notes since this briefing: F09, F10");
    expect(newNotesLine(NOTES_ONLY)).toBe("1 new note since this briefing: F09");
    expect(newNotesLine(CURRENT)).toBeNull();
  });
});
