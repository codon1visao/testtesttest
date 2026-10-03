import { describe, expect, it } from "vitest";
import {
  checkFeedbackLimits,
  FEEDBACK_TOTAL_TEXT_MAX_BYTES,
  feedbackIdFor,
} from "./feedback-limits.js";

describe("feedback limits (F3, S1 resource controls)", () => {
  it("allows a note within both limits", () => {
    expect(checkFeedbackLimits([{ text: "a" }], "b", 2)).toEqual({ ok: true });
  });

  it("stops at the note count", () => {
    expect(checkFeedbackLimits([{ text: "a" }, { text: "b" }], "c", 2)).toEqual({
      ok: false,
      reason: "count",
    });
  });

  it("counts UTF-8 bytes, so multi-byte text reaches the size limit sooner", () => {
    const half = "é".repeat(FEEDBACK_TOTAL_TEXT_MAX_BYTES / 4); // 2 bytes each → half the limit
    expect(checkFeedbackLimits([{ text: half }], half, 100)).toEqual({ ok: true });
    expect(checkFeedbackLimits([{ text: half }], `${half}x`, 100)).toEqual({
      ok: false,
      reason: "size",
    });
  });

  it("formats stable IDs with at least two digits", () => {
    expect([feedbackIdFor(9), feedbackIdFor(10), feedbackIdFor(100)]).toEqual([
      "F09",
      "F10",
      "F100",
    ]);
  });
});
