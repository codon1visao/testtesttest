import { EventIdSchema, RunIdSchema } from "@event-desk/contracts";
import { describe, expect, it, vi } from "vitest";
import type { BatchJobContext } from "../../ports/briefing-batch-queue.js";
import { createLogger } from "../../shared/logger.js";
import { FakeGenerationLimits } from "../../testing/fake-generation-limits.js";
import { BatchGenerationProcessor } from "./batch-generation-processor.js";
import type { BatchAttemptResult } from "./briefing-generation-service.js";

const E101 = EventIdSchema.parse("E101");
const RUN = RunIdSchema.parse("batch_run-1");
const NOW = new Date("2026-10-04T10:00:00.000Z");

function setup(
  options: {
    results?: BatchAttemptResult[];
    hasOutcome?: boolean;
    manualRunning?: boolean;
    limits?: FakeGenerationLimits;
  } = {},
) {
  const events: string[] = [];
  const results = [...(options.results ?? [{ kind: "finished", status: "succeeded" } as const])];
  let manualRunning = options.manualRunning ?? false;
  let releaseManual: () => void = () => undefined;
  const manualDone = new Promise<void>((resolve) => {
    releaseManual = () => {
      manualRunning = false;
      resolve();
    };
  });
  const generation = {
    generateBatch: vi.fn((command: { deadlineAt: Date }): Promise<BatchAttemptResult> => {
      events.push(`generate:${command.deadlineAt.toISOString()}`);
      return Promise.resolve(results.shift() ?? { kind: "finished", status: "succeeded" });
    }),
    recordBatchOutcome: vi.fn((_e: unknown, _r: unknown, status: string, code?: string) => {
      events.push(`record:${status}${code === undefined ? "" : `:${code}`}`);
      return Promise.resolve();
    }),
    hasOutcome: vi.fn(() => Promise.resolve(options.hasOutcome ?? false)),
  };
  const manual = {
    manualStatus: vi.fn(() =>
      manualRunning ? { runId: RunIdSchema.parse("manual:x"), startedAt: NOW.toISOString() } : null,
    ),
    whenIdle: vi.fn(() => {
      events.push("whenIdle");
      return manualDone;
    }),
  };
  const publish = vi.fn(() => Promise.resolve());
  const processor = new BatchGenerationProcessor({
    generation,
    manual,
    limits: options.limits ?? new FakeGenerationLimits(),
    changes: { publish },
    clock: { now: () => NOW },
    logger: createLogger("silent"),
    random: () => 0.5,
  });
  const job = (overrides: Partial<BatchJobContext> = {}): BatchJobContext => ({
    runId: RUN,
    eventId: E101,
    attempt: 1,
    maxAttempts: 3,
    firstStartedAt: NOW,
    interruptedWhileSending: false,
    markSending: () => Promise.resolve(),
    markSettled: () => Promise.resolve(),
    reportPhase: (phase) => {
      events.push(`phase:${phase}`);
      return Promise.resolve();
    },
    hasNewerReadyJob: () => Promise.resolve(false),
    isShuttingDown: () => false,
    ...overrides,
  });
  return { processor, job, events, generation, publish, releaseManual };
}

describe("BatchGenerationProcessor (T5 §3, F7)", () => {
  it("runs one attempt with a 60 s deadline and finishes", async () => {
    const { processor, job, events } = setup();
    expect(await processor.handle(job())).toEqual({ kind: "done" });
    expect(events).toEqual([`generate:${new Date(NOW.getTime() + 60_000).toISOString()}`]);
  });

  it("F7-11: an execution interrupted mid-call is AI_OUTCOME_UNKNOWN and never replayed", async () => {
    const { processor, job, events, generation } = setup();
    expect(await processor.handle(job({ interruptedWhileSending: true }))).toEqual({
      kind: "done",
    });
    expect(events).toEqual(["record:failed:AI_OUTCOME_UNKNOWN"]);
    expect(generation.generateBatch).not.toHaveBeenCalled();
  });

  it("an interrupted run that had already committed just finishes", async () => {
    const { processor, job, events } = setup({ hasOutcome: true });
    await processor.handle(job({ interruptedWhileSending: true }));
    expect(events).toEqual([]);
  });

  it("F7-05: a newer ready job supersedes this one without a call", async () => {
    const { processor, job, events } = setup();
    await processor.handle(job({ hasNewerReadyJob: () => Promise.resolve(true) }));
    expect(events).toEqual(["record:superseded"]);
  });

  it("F7-07: waits for a running manual generation before generating", async () => {
    const { processor, job, events, releaseManual } = setup({ manualRunning: true });
    const handled = processor.handle(job());
    await vi.waitFor(() => {
      expect(events).toEqual(["phase:waiting", "whenIdle"]);
    });
    releaseManual();
    await handled;
    expect(events.slice(2)).toEqual([
      "phase:generating",
      `generate:${new Date(NOW.getTime() + 60_000).toISOString()}`,
    ]);
  });

  it("T3 §10: a shutdown that starts while waiting for a manual run parks the job without a call", async () => {
    const { processor, job, events, generation, releaseManual } = setup({ manualRunning: true });
    let shuttingDown = false;
    let settled = false;
    void processor.handle(job({ isShuttingDown: () => shuttingDown })).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => {
      expect(events).toEqual(["phase:waiting", "whenIdle"]);
    });
    shuttingDown = true;
    releaseManual();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Never finished, failed or recorded: the job stalls and resumes on the next start.
    expect(settled).toBe(false);
    expect(generation.generateBatch).not.toHaveBeenCalled();
    expect(generation.recordBatchOutcome).not.toHaveBeenCalled();
    expect(events).toEqual(["phase:waiting", "whenIdle"]);
  });

  it("F7-12: a temporary failure retries after the provider's wait", async () => {
    const { processor, job } = setup({
      results: [{ kind: "retryable", code: "PROVIDER_RATE_LIMITED", retryAfterMs: 20_000 }],
    });
    expect(await processor.handle(job())).toEqual({ kind: "retry", delayMs: 20_000 });
  });

  it("the shared cooldown lengthens the wait", async () => {
    const limits = new FakeGenerationLimits();
    limits.cooldownEnd = new Date(NOW.getTime() + 45_000);
    const { processor, job } = setup({
      results: [{ kind: "retryable", code: "PROVIDER_TEMPORARY" }],
      limits,
    });
    expect(await processor.handle(job())).toEqual({ kind: "retry", delayMs: 45_000 });
  });

  it("the last failed attempt is ATTEMPTS_EXHAUSTED", async () => {
    const { processor, job, events } = setup({
      results: [{ kind: "retryable", code: "PROVIDER_TEMPORARY" }],
    });
    expect(await processor.handle(job({ attempt: 3 }))).toEqual({ kind: "done" });
    expect(events.at(-1)).toBe("record:failed:ATTEMPTS_EXHAUSTED");
  });

  it("past the 5-minute execution deadline, no further call", async () => {
    const { processor, job, events, generation } = setup();
    await processor.handle(job({ attempt: 2, firstStartedAt: new Date(NOW.getTime() - 300_000) }));
    expect(generation.generateBatch).not.toHaveBeenCalled();
    expect(events).toEqual(["record:failed:ATTEMPTS_EXHAUSTED"]);
  });

  it("records an abandoned job as INTERNAL and publishes state changes", async () => {
    const { processor, events, publish } = setup();
    await processor.abandoned({ runId: RUN, eventId: E101 });
    await processor.stateChanged(E101);
    expect(events).toEqual(["record:failed:INTERNAL"]);
    expect(publish).toHaveBeenCalledWith(E101);
  });
});
