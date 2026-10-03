import { describe, expect, it } from "vitest";
import { feedbackDraftProblem } from "./feedback-form-model";

describe("feedbackDraftProblem (F3 validation)", () => {
  it("accepts text of 1–1,000 characters after trimming, as written", () => {
    expect(feedbackDraftProblem("  Fine.  ")).toBeNull();
    expect(feedbackDraftProblem("é".repeat(1_000))).toBeNull();
  });
  it("rejects blank and whitespace-only text, including tabs and newlines", () => {
    expect(feedbackDraftProblem("")).toBe("blank");
    expect(feedbackDraftProblem(" \t\n ")).toBe("blank");
  });
  it("rejects more than 1,000 characters", () => {
    expect(feedbackDraftProblem("x".repeat(1_001))).toBe("too-long");
  });
});
