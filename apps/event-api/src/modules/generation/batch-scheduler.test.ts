import { type EventId, EventIdSchema, RunIdSchema } from "@event-desk/contracts";
import { describe, expect, it, vi } from "vitest";
import type { BatchJobStatus } from "../../ports/briefing-batch-queue.js";
import type { ReadScope, TransactionScope, UnitOfWork } from "../../ports/unit-of-work.js";
import { createLogger } from "../../shared/logger.js";
import { BatchScheduler } from "./batch-scheduler.js";

const E101 = EventIdSchema.parse("E101");
const E102 = EventIdSchema.parse("E102");
const E103 = EventIdSchema.parse("E103");
const LIVE: BatchJobStatus = {
  jobId: RunIdSchema.parse("batch_a"),
  state: "collecting",
  openedAt: new Date(0),
  closesAt: new Date(3_000),
  maxAttempts: 3,
};

/** Only the pending-feedback read is reachable from the scheduler. */
function pendingUow(pending: () => Promise<EventId[]>): UnitOfWork {
  const unreachable = () => Promise.reject(new Error("not used by the scheduler"));
  const scope: ReadScope = {
    events: {
      findAggregate: unreachable,
      pendingFeedbackEventIds: pending,
      feedbackState: unreachable,
    },
    briefings: { loadSlots: unreachable },
    outcomes: { latest: unreachable, statusOf: unreachable },
  };
  return {
    run: (_work: (tx: TransactionScope) => Promise<unknown>) => unreachable(),
    readSnapshot: (work) => work(scope),
  };
}

function setup(options: {
  pending?: () => Promise<EventId[]>;
  status?: (eventId: EventId) => Promise<BatchJobStatus | null>;
  schedule?: (eventId: EventId) => Promise<void>;
}) {
  const lines: string[] = [];
  const queue = {
    schedule: vi.fn(options.schedule ?? (() => Promise.resolve())),
    status: vi.fn(options.status ?? (() => Promise.resolve(null))),
  };
  const publish = vi.fn(() => Promise.resolve());
  const scheduler = new BatchScheduler({
    queue,
    uow: pendingUow(options.pending ?? (() => Promise.resolve([]))),
    changes: { publish },
    logger: createLogger("info", { write: (chunk: string) => void lines.push(chunk) }),
  });
  const warnings = (text: string) => lines.filter((line) => line.includes(text)).length;
  return { scheduler, queue, publish, warnings };
}

describe("BatchScheduler (F7 Durability)", () => {
  it("schedules and publishes the collecting state", async () => {
    const { scheduler, queue, publish } = setup({});
    expect(await scheduler.scheduleOrDefer(E101)).toBe("scheduled");
    expect(queue.schedule).toHaveBeenCalledWith(E101);
    expect(publish).toHaveBeenCalledWith(E101);
  });

  it("defers without publishing when the queue is unavailable", async () => {
    const { scheduler, publish, warnings } = setup({
      schedule: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    expect(await scheduler.scheduleOrDefer(E101)).toBe("deferred");
    expect(publish).not.toHaveBeenCalled();
    expect(warnings("automatic briefing deferred")).toBe(1);
  });

  it("reconcile re-schedules pending events that have no live job, and skips those that do", async () => {
    const { scheduler, queue } = setup({
      pending: () => Promise.resolve([E101, E102]),
      status: (eventId) => Promise.resolve(eventId === E101 ? LIVE : null),
    });
    await scheduler.reconcile();
    expect(queue.schedule.mock.calls).toEqual([[E102]]);
  });

  it("reconcile stays quiet but logged when the pending events cannot be read", async () => {
    const { scheduler, queue, warnings } = setup({
      pending: () => Promise.reject(new Error("MySQL down")),
    });
    await expect(scheduler.reconcile()).resolves.toBeUndefined();
    expect(queue.status).not.toHaveBeenCalled();
    expect(warnings("pending feedback could not be read at startup")).toBe(1);
  });

  it("P6: reconcile stops at the first queue error and logs it once", async () => {
    const { scheduler, queue, warnings } = setup({
      pending: () => Promise.resolve([E101, E102, E103]),
      status: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    await expect(scheduler.reconcile()).resolves.toBeUndefined();
    expect(queue.status).toHaveBeenCalledTimes(1);
    expect(queue.schedule).not.toHaveBeenCalled();
    expect(warnings("pending feedback could not be re-scheduled")).toBe(1);
  });

  it("P6: reconcile stops once a schedule is deferred (the queue is down for every event)", async () => {
    const { scheduler, queue, warnings } = setup({
      pending: () => Promise.resolve([E101, E102, E103]),
      schedule: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    await scheduler.reconcile();
    expect(queue.schedule).toHaveBeenCalledTimes(1);
    expect(warnings("automatic briefing deferred")).toBe(1);
  });

  it("reconcile continues past a publish failure, which only delays the view", async () => {
    const { scheduler, queue, publish } = setup({
      pending: () => Promise.resolve([E101, E102]),
    });
    publish.mockRejectedValueOnce(new Error("flush failed"));
    await scheduler.reconcile();
    expect(queue.schedule.mock.calls).toEqual([[E101], [E102]]);
  });
});
