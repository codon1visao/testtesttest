import { describe, expect, it } from "vitest";
import { ApiError } from "../../data/http/api-error";
import { mayHaveBeenCharged } from "./use-generate-control";

describe("mayHaveBeenCharged (T3 §11: Retry asks first)", () => {
  it.each([
    [
      "an http AI_OUTCOME_UNKNOWN",
      new ApiError("http", "x", { status: 504, code: "AI_OUTCOME_UNKNOWN" }),
    ],
    [
      "an http DEADLINE_EXCEEDED",
      new ApiError("http", "x", { status: 504, code: "DEADLINE_EXCEEDED" }),
    ],
    ["a request timeout", new ApiError("timeout", "x")],
    ["a lost connection", new ApiError("network", "x")],
    ["an unreadable reply", new ApiError("invalid-response", "x", { status: 201 })],
  ])("is true for %s", (_name, error) => {
    expect(mayHaveBeenCharged(error)).toBe(true);
  });

  it.each([
    ["GATEWAY_UNAVAILABLE", 503],
    ["OUTPUT_INVALID", 502],
    ["ATTENDANCE_CONFLICT", 409],
  ] as const)("is false for an http %s", (code, status) => {
    expect(mayHaveBeenCharged(new ApiError("http", "x", { status, code }))).toBe(false);
  });

  it.each([
    ["a plain Error", new Error("boom")],
    ["a string", "boom"],
    ["null", null],
  ])("is false for %s, which is not an ApiError", (_name, error) => {
    expect(mayHaveBeenCharged(error)).toBe(false);
  });
});
