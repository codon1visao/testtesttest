import {
  type BriefingView,
  EventIdSchema,
  GenerationIdSchema,
  RunIdSchema,
} from "@event-desk/contracts";
import { buildBriefingView } from "@event-desk/contracts/testing";
import { describe, expect, it, vi } from "vitest";
import type { IdGenerator } from "../../ports/id-generator.js";
import { AppError } from "../../shared/app-error.js";
import { createLogger } from "../../shared/logger.js";
import type { ManualGenerateCommand } from "./briefing-generation-service.js";
import { ManualGenerationCoordinator } from "./manual-generation-coordinator.js";

const E101 = EventIdSchema.parse("E101");
const START = new Date("2026-10-04T10:00:00.000Z");
let runs = 0;
const ids: IdGenerator = {
  generationId: () => GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f"),
  itemId: () => "item",
  manualRunId: () => RunIdSchema.parse(`manual:run-${(runs += 1)}`),
  batchRunId: () => RunIdSchema.parse(`batch_run-${(runs += 1)}`),
};

/** `failPublishAt` lists the publish calls (1 = start flush, 2 = finish flush) that reject. */
function setup({ failPublishAt = [] as number[] } = {}) {
  const lines: string[] = [];
  let publishes = 0;
  const pending: { command: ManualGenerateCommand; result: PromiseWithResolvers<BriefingView> }[] =
    [];
  const events: string[] = [];
  const generation = {
    generateManual: vi.fn((command: ManualGenerateCommand) => {
      events.push("generate");
      const result = Promise.withResolvers<BriefingView>();
      pending.push({ command, result });
      return result.promise;
    }),
  };
  const coordinator = new ManualGenerationCoordinator({
    generation,
    ids,
    clock: { now: () => START },
    changes: {
      publish: vi.fn(() => {
        publishes += 1;
        events.push(`publish:${coordinator.manualStatus(E101) === null ? "idle" : "running"}`);
        return failPublishAt.includes(publishes)
          ? Promise.reject(new Error("publish failed"))
          : Promise.resolve();
      }),
    },
    timeoutMs: 60_000,
    logger: createLogger("info", { write: (chunk: string) => void lines.push(chunk) }),
  });
  return { coordinator, generation, pending, events, lines };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ManualGenerationCoordinator", () => {
  it("F4-07: concurrent requests join one run and get the same preview", async () => {
    const { coordinator, generation, pending } = setup();
    const first = coordinator.generate(E101, 0);
    const second = coordinator.generate(E101, 3);
    await settled();
    expect(generation.generateManual).toHaveBeenCalledTimes(1);
    const preview = buildBriefingView();
    pending[0]?.result.resolve(preview);
    expect(await first).toBe(preview);
    expect(await second).toBe(preview);
  });

  it("starts the run with a manual run ID and a deadline of startedAt + timeout", async () => {
    const { coordinator, pending } = setup();
    void coordinator.generate(E101, 0);
    await settled();
    expect(pending[0]?.command).toMatchObject({ eventId: E101, baseAttendanceRevision: 0 });
    expect(pending[0]?.command.runId).toMatch(/^manual:run-\d+$/);
    expect(pending[0]?.command.deadlineAt).toEqual(new Date(START.getTime() + 60_000));
  });

  it("reports the run while it is in flight and flushes before and after it", async () => {
    const { coordinator, pending, events } = setup();
    const run = coordinator.generate(E101, 0);
    await settled();
    expect(coordinator.manualStatus(E101)).toEqual({
      runId: pending[0]?.command.runId,
      startedAt: START.toISOString(),
    });
    pending[0]?.result.resolve(buildBriefingView());
    await run;
    expect(events).toEqual(["publish:running", "generate", "publish:idle"]);
    expect(coordinator.manualStatus(E101)).toBeNull();
  });

  it("releases the event after a failure so the next Generate starts a new run", async () => {
    const { coordinator, generation, pending } = setup();
    const failed = coordinator.generate(E101, 0);
    await settled();
    pending[0]?.result.reject(new AppError("GATEWAY_UNAVAILABLE", "down"));
    await expect(failed).rejects.toBeInstanceOf(AppError);
    void coordinator.generate(E101, 0);
    await settled();
    expect(generation.generateManual).toHaveBeenCalledTimes(2);
    expect(pending[1]?.command.runId).not.toBe(pending[0]?.command.runId);
  });

  it("flushes after a failed run too and surfaces the original error", async () => {
    const { coordinator, pending, events } = setup();
    const failed = coordinator.generate(E101, 0);
    await settled();
    const original = new AppError("GATEWAY_UNAVAILABLE", "down");
    pending[0]?.result.reject(original);
    await expect(failed).rejects.toBe(original);
    expect(events).toEqual(["publish:running", "generate", "publish:idle"]);
  });

  it.each([
    ["the start flush fails", [1]],
    ["the finish flush fails", [2]],
    ["both flushes fail", [1, 2]],
  ])("still returns the preview when %s", async (_name, failPublishAt) => {
    const { coordinator, generation, pending, lines } = setup({ failPublishAt });
    const run = coordinator.generate(E101, 0);
    await settled();
    expect(generation.generateManual).toHaveBeenCalledTimes(1);
    const preview = buildBriefingView();
    pending[0]?.result.resolve(preview);
    expect(await run).toBe(preview);
    expect(lines.join("")).toContain("manual generation flush failed");
    expect(coordinator.manualStatus(E101)).toBeNull();
  });

  it("keeps the original error when the finish flush fails", async () => {
    const { coordinator, pending } = setup({ failPublishAt: [2] });
    const failed = coordinator.generate(E101, 0);
    await settled();
    const original = new AppError("DEADLINE_EXCEEDED", "late");
    pending[0]?.result.reject(original);
    await expect(failed).rejects.toBe(original);
  });
});

describe("whenIdle / whenAllIdle (T5 §2, F7 coordinator priority)", () => {
  it("settles when the running generation finishes, even if it fails; immediately when idle", async () => {
    const { coordinator, pending } = setup();
    await expect(coordinator.whenIdle(E101)).resolves.toBeUndefined();
    const run = coordinator.generate(E101, 0);
    run.catch(() => undefined);
    let idle = false;
    const waiting = coordinator.whenIdle(E101).then(() => {
      idle = true;
    });
    await vi.waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    expect(idle).toBe(false);
    pending[0]?.result.reject(new AppError("PROVIDER_REFUSED", "refused."));
    await waiting;
    expect(idle).toBe(true);
    await expect(coordinator.whenAllIdle()).resolves.toBeUndefined();
    expect(coordinator.manualStatus(E101)).toBeNull();
  });

  it("whenAllIdle waits for every event's run and reports each run while it is in flight", async () => {
    const { coordinator, pending } = setup();
    const E102 = EventIdSchema.parse("E102");
    void coordinator.generate(E101, 0);
    void coordinator.generate(E102, 0);
    await vi.waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    expect(coordinator.manualStatus(E101)).toEqual({
      runId: pending[0]?.command.runId,
      startedAt: START.toISOString(),
    });
    let drained = false;
    const draining = coordinator.whenAllIdle().then(() => {
      drained = true;
    });
    pending[0]?.result.resolve(buildBriefingView());
    await settled();
    expect(drained).toBe(false);
    pending[1]?.result.resolve(buildBriefingView());
    await draining;
    expect(coordinator.manualStatus(E102)).toBeNull();
  });
});
