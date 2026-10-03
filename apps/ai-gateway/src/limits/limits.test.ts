import { describe, expect, it } from "vitest";
import { LaneGate } from "./lane-gate.js";
import { UsageBackstop } from "./usage-backstop.js";

describe("LaneGate", () => {
  it("allows one call per lane, independently per lane, and frees the lane on release", () => {
    const gate = new LaneGate();
    const interactive = gate.tryEnter("interactive");
    expect(interactive).not.toBeNull();
    expect(gate.tryEnter("interactive")).toBeNull();
    expect(gate.tryEnter("background")).not.toBeNull();
    interactive?.();
    interactive?.(); // releasing twice is harmless
    expect(gate.tryEnter("interactive")).not.toBeNull();
  });
});

describe("UsageBackstop", () => {
  it("caps calls per UTC day and resets at midnight UTC", () => {
    let now = new Date("2026-10-03T23:59:00.000Z");
    const backstop = new UsageBackstop(2, () => now);
    expect([backstop.tryConsume(), backstop.tryConsume(), backstop.tryConsume()]).toEqual([
      true,
      true,
      false,
    ]);
    now = new Date("2026-10-04T00:00:01.000Z");
    expect(backstop.tryConsume()).toBe(true);
  });
});
