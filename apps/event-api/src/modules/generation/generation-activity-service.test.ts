import { RunIdSchema, SUPPLIED_EVENT } from "@event-desk/contracts";
import { describe, expect, it, vi } from "vitest";
import type { BatchJobStatus } from "../../ports/briefing-batch-queue.js";
import { createLogger } from "../../shared/logger.js";
import { FakeGenerationLimits } from "../../testing/fake-generation-limits.js";
import { GenerationActivityService } from "./generation-activity-service.js";

const E101 = SUPPLIED_EVENT.id;
const NOW = new Date("2026-10-04T10:00:00.000Z");
const MANUAL = { runId: RunIdSchema.parse("manual:run-1"), startedAt: NOW.toISOString() };
const COLLECTING: BatchJobStatus = {
  jobId: RunIdSchema.parse("batch_a"),
  state: "collecting",
  openedAt: NOW,
  closesAt: new Date(NOW.getTime() + 3_000),
  maxAttempts: 3,
};

function setup(status: () => Promise<BatchJobStatus | null>, limits = new FakeGenerationLimits()) {
  const lines: string[] = [];
  const service = new GenerationActivityService({
    manual: { manualStatus: vi.fn(() => MANUAL) },
    queue: { status: vi.fn(status) },
    limits,
    clock: { now: () => NOW },
    logger: createLogger("info", { write: (chunk: string) => void lines.push(chunk) }),
  });
  return { service, limits, lines };
}

describe("GenerationActivityService (T3 §5 live generation state)", () => {
  it("combines the manual run, the batch job and the provider cooldown", async () => {
    const { service, limits } = setup(() => Promise.resolve(COLLECTING));
    limits.cooldownEnd = new Date(NOW.getTime() + 40_000);
    expect(await service.current(E101)).toEqual({
      manual: MANUAL,
      batch: COLLECTING,
      batchKnown: true,
      cooldownUntil: new Date(NOW.getTime() + 40_000),
    });
  });

  it("P9: reads the batch status and the cooldown in parallel", async () => {
    const limits = new FakeGenerationLimits();
    const cooldownRead = vi.spyOn(limits, "cooldownUntil");
    let answerStatus: (status: BatchJobStatus | null) => void = () => undefined;
    const { service } = setup(
      () =>
        new Promise((resolve) => {
          answerStatus = resolve;
        }),
      limits,
    );
    const current = service.current(E101);
    await vi.waitFor(() => {
      expect(cooldownRead).toHaveBeenCalledTimes(1);
    });
    answerStatus(null);
    await expect(current).resolves.toMatchObject({ batch: null, batchKnown: true });
  });

  it("shows no batch job when the queue store is unreachable, and logs it", async () => {
    const { service, lines } = setup(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(await service.current(E101)).toEqual({
      manual: MANUAL,
      batch: null,
      batchKnown: false,
      cooldownUntil: null,
    });
    expect(lines.join("")).toContain("batch status unavailable");
  });
});
