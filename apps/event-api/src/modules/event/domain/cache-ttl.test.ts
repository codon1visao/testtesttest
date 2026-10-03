import { RunIdSchema } from "@event-desk/contracts";
import { buildSeedEventView } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import { cacheTtlMs } from "./cache-ttl.js";

const NOW = new Date("2026-10-03T09:00:00.000Z");
const withGeneration = (closesAt: string | undefined, cooldownUntil: string | null) =>
  buildSeedEventView({
    generation: {
      manual: null,
      batch:
        closesAt === undefined
          ? null
          : { state: "collecting", jobId: RunIdSchema.parse("7"), closesAt, newNoteIds: [] },
      lastOutcome: null,
      cooldownUntil,
    },
  });

describe("cacheTtlMs", () => {
  it("uses the default TTL when nothing is time-driven", () => {
    expect(cacheTtlMs(buildSeedEventView(), NOW, 30_000)).toBe(30_000);
  });

  it("caps the TTL at the batch cutoff", () => {
    expect(cacheTtlMs(withGeneration("2026-10-03T09:00:02.500Z", null), NOW, 30_000)).toBe(2_500);
  });

  it("takes the earliest time-driven change", () => {
    expect(
      cacheTtlMs(
        withGeneration("2026-10-03T09:00:05.000Z", "2026-10-03T09:00:01.000Z"),
        NOW,
        30_000,
      ),
    ).toBe(1_000);
  });

  it("returns 0 when a deadline has already passed, so nothing is cached", () => {
    expect(cacheTtlMs(withGeneration("2026-10-03T08:59:59.000Z", null), NOW, 30_000)).toBe(0);
  });
});
