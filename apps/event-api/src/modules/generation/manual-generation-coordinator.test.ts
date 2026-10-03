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
import type { ManualGenerateCommand } from "./briefing-generation-service.js";
import { ManualGenerationCoordinator } from "./manual-generation-coordinator.js";

const E101 = EventIdSchema.parse("E101");
const START = new Date("2026-10-04T10:00:00.000Z");
let runs = 0;
const ids: IdGenerator = {
  generationId: () => GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f"),
  itemId: () => "item",
  manualRunId: () => RunIdSchema.parse(`manual:run-${(runs += 1)}`),
};

function setup() {
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
      publish: vi.fn(async () => {
        events.push(
          `publish:${(await coordinator.current(E101)).manual === null ? "idle" : "running"}`,
        );
      }),
    },
    timeoutMs: 60_000,
  });
  return { coordinator, generation, pending, events };
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
    expect((await coordinator.current(E101)).manual).toEqual({
      runId: pending[0]?.command.runId,
      startedAt: START.toISOString(),
    });
    pending[0]?.result.resolve(buildBriefingView());
    await run;
    expect(events).toEqual(["publish:running", "generate", "publish:idle"]);
    expect(await coordinator.current(E101)).toEqual({
      manual: null,
      batch: null,
      cooldownUntil: null,
    });
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
});
