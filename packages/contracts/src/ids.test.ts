import { describe, expect, it } from "vitest";
import {
  EventIdSchema,
  FeedbackIdSchema,
  GenerationIdSchema,
  MemberIdSchema,
  RunIdSchema,
} from "./ids.js";

describe("business identifiers", () => {
  it("accepts the supplied formats", () => {
    expect(EventIdSchema.parse("E101")).toBe("E101");
    expect(MemberIdSchema.parse("M01")).toBe("M01");
    expect(FeedbackIdSchema.parse("F08")).toBe("F08");
    expect(FeedbackIdSchema.parse("F100")).toBe("F100");
  });

  it.each(["f01", " F01", "F01 ", "F1", "F", "F01x", "F1234567890123456"])(
    "rejects feedback ID %j (exact, case-sensitive, at most 16 characters)",
    (id) => {
      expect(FeedbackIdSchema.safeParse(id).success).toBe(false);
    },
  );

  it.each(["m01", "M1", "M", "E101"])("rejects member ID %j", (id) => {
    expect(MemberIdSchema.safeParse(id).success).toBe(false);
  });

  it("requires UUIDv7 generation IDs", () => {
    expect(GenerationIdSchema.safeParse("0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f").success).toBe(true);
    expect(GenerationIdSchema.safeParse("8c2a4f0e-2b1d-4c3e-9f4a-1b2c3d4e5f60").success).toBe(
      false,
    );
  });

  it("rejects uppercase generation IDs, which can never match the ascii_bin column", () => {
    expect(GenerationIdSchema.safeParse("0199A4E8-7C1A-7CC2-9D6E-2F3B4C5D6E7F").success).toBe(
      false,
    );
  });

  it("accepts manual run IDs and BullMQ job IDs, up to 64 safe characters", () => {
    expect(RunIdSchema.safeParse("manual:0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f").success).toBe(true);
    expect(RunIdSchema.safeParse("42").success).toBe(true);
    expect(RunIdSchema.safeParse("a".repeat(65)).success).toBe(false);
    expect(RunIdSchema.safeParse("run id").success).toBe(false);
  });
});
