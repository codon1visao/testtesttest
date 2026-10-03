import { describe, expect, it } from "vitest";
import { assertNever } from "./assert-never.js";

describe("assertNever", () => {
  it("throws with the unexpected value when a union case is unhandled", () => {
    expect(() => assertNever("late" as never, "attendance status")).toThrow(
      'Unhandled attendance status: "late"',
    );
  });
});
