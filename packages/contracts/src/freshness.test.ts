import { describe, expect, it } from "vitest";
import type { AttendanceStatus } from "./attendance.js";
import { computeFreshness, type FreshnessBaseline } from "./freshness.js";
import { FeedbackIdSchema, MemberIdSchema } from "./ids.js";

const m = (id: string) => MemberIdSchema.parse(id);
const f = (...ids: string[]) => ids.map((id) => FeedbackIdSchema.parse(id));

const baseline: FreshnessBaseline = {
  attendance: [
    { memberId: m("M01"), attendance: "attended" },
    { memberId: m("M02"), attendance: "absent" },
    { memberId: m("M03"), attendance: "not_recorded" },
    { memberId: m("M04"), attendance: "absent" },
  ],
  feedbackIds: f("F01", "F02"),
  feedbackDigest: "a".repeat(64),
};

const members = (...statuses: AttendanceStatus[]) =>
  statuses.map((attendance, i) => ({ id: m(`M0${i + 1}`), attendance }));
const sameFeedback = { feedbackIds: f("F01", "F02"), feedbackDigest: "a".repeat(64) };

describe("computeFreshness", () => {
  it("is current when nothing changed", () => {
    const current = {
      members: members("attended", "absent", "not_recorded", "absent"),
      ...sameFeedback,
    };
    expect(computeFreshness(baseline, current)).toEqual({
      current: true,
      attendanceChanges: [],
      newFeedbackIds: [],
    });
  });

  it("names the member whose status changed (Chris: Not recorded → Attended)", () => {
    const current = {
      members: members("attended", "absent", "attended", "absent"),
      ...sameFeedback,
    };
    expect(computeFreshness(baseline, current)).toEqual({
      current: false,
      attendanceChanges: [{ memberId: "M03", from: "not_recorded", to: "attended" }],
      newFeedbackIds: [],
    });
  });

  it("treats a swap with equal counts as two changes (T4-07, F2-07)", () => {
    const current = {
      members: members("absent", "attended", "not_recorded", "absent"),
      ...sameFeedback,
    };
    const result = computeFreshness(baseline, current);
    expect(result.current).toBe(false);
    expect(result.attendanceChanges.map((c) => c.memberId)).toEqual(["M01", "M02"]);
  });

  it("is current again after an exact revert (D5)", () => {
    const reverted = {
      members: members("attended", "absent", "not_recorded", "absent"),
      ...sameFeedback,
    };
    expect(computeFreshness(baseline, reverted).current).toBe(true);
  });

  it("lists new notes in numeric order", () => {
    const current = {
      members: members("attended", "absent", "not_recorded", "absent"),
      feedbackIds: f("F01", "F02", "F100", "F11", "F09"),
      feedbackDigest: "b".repeat(64),
    };
    expect(computeFreshness(baseline, current)).toEqual({
      current: false,
      attendanceChanges: [],
      newFeedbackIds: ["F09", "F11", "F100"],
    });
  });

  it("is out of date when the captured notes' digest no longer matches", () => {
    const current = {
      members: members("attended", "absent", "not_recorded", "absent"),
      feedbackIds: f("F01", "F02"),
      feedbackDigest: "c".repeat(64),
    };
    expect(computeFreshness(baseline, current).current).toBe(false);
  });
});
