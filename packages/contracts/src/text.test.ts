import { describe, expect, it } from "vitest";
import { boundedText, textLength } from "./text.js";

describe("boundedText", () => {
  const schema = boundedText(5);

  it("returns the value exactly as written (trimming is for validation only)", () => {
    expect(schema.parse("  hi\n")).toBe("  hi\n");
  });

  it.each(["", "   ", "\n\t "])("rejects blank text %j", (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it("applies the maximum to the stored string, including surrounding whitespace", () => {
    expect(schema.safeParse("abcde").success).toBe(true);
    expect(schema.safeParse(" abcde").success).toBe(false);
  });

  it("counts code points like MySQL CHAR_LENGTH, not UTF-16 units", () => {
    expect(textLength("😀😀")).toBe(2);
    expect(schema.safeParse("😀😀😀😀😀").success).toBe(true);
    expect(schema.safeParse("😀😀😀😀😀😀").success).toBe(false);
  });

  it("accepts 1,000 emoji in a 1,000-character field", () => {
    expect(boundedText(1000).safeParse("😀".repeat(1000)).success).toBe(true);
  });
});
