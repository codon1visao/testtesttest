import { describe, expect, it, vi } from "vitest";
import { commitThenEffects } from "./typeorm-unit-of-work.js";

describe("commitThenEffects (Plan 3B carry-forward)", () => {
  it("runs effects after a successful commit", async () => {
    const effects = vi.fn(() => Promise.resolve());
    await commitThenEffects(() => Promise.resolve(), effects);
    expect(effects).toHaveBeenCalledTimes(1);
  });

  it("still flushes when COMMIT itself fails (the commit may have happened), then rethrows", async () => {
    const effects = vi.fn(() => Promise.resolve());
    const failure = new Error("commit timeout");
    await expect(commitThenEffects(() => Promise.reject(failure), effects)).rejects.toBe(failure);
    expect(effects).toHaveBeenCalledTimes(1);
  });
});
