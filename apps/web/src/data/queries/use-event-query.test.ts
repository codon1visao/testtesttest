import { RunIdSchema } from "@event-desk/contracts";
import { buildSeedEventView } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import { pollIntervalMs } from "./use-event-query";

const withBatch = (state: "collecting" | "waiting" | "generating" | "retry_wait") =>
  buildSeedEventView({
    generation: {
      manual: null,
      batch: { state, jobId: RunIdSchema.parse("batch_a"), newNoteIds: [], maxAttempts: 3 },
      lastOutcome: null,
      cooldownUntil: null,
    },
  });

describe("pollIntervalMs (F7 polling fallback)", () => {
  it("does not poll while the stream is open", () => {
    expect(pollIntervalMs(withBatch("collecting"), true)).toBe(false);
  });
  it("polls every second while a batch collects or generates, otherwise every five", () => {
    expect(pollIntervalMs(withBatch("collecting"), false)).toBe(1_000);
    expect(pollIntervalMs(withBatch("generating"), false)).toBe(1_000);
    expect(pollIntervalMs(withBatch("retry_wait"), false)).toBe(5_000);
    expect(pollIntervalMs(buildSeedEventView(), false)).toBe(5_000);
    expect(pollIntervalMs(undefined, false)).toBe(5_000);
  });
});
