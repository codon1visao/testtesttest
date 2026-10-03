import { describe, expect, it } from "vitest";
import { secretsMatch } from "./auth.js";

const SECRET = "s".repeat(32);

describe("secretsMatch", () => {
  it("accepts only the exact secret", () => {
    expect(secretsMatch(SECRET, SECRET)).toBe(true);
    expect(secretsMatch(`${SECRET}x`, SECRET)).toBe(false);
    expect(secretsMatch("", SECRET)).toBe(false);
  });

  it("rejects non-string credentials", () => {
    for (const value of [undefined, null, 42, { secret: SECRET }]) {
      expect(secretsMatch(value, SECRET)).toBe(false);
    }
  });
});
