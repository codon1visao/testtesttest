import { RunIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { hasNewerReadyJob, pickBatchStatus, type QueuedBatchJob } from "./batch-jobs.js";

const job = (id: string, overrides: Partial<QueuedBatchJob> = {}): QueuedBatchJob => ({
  jobId: RunIdSchema.parse(id),
  queueState: "delayed",
  createdAt: 1_000,
  readyAt: 4_000,
  attemptsMade: 0,
  ...overrides,
});

describe("pickBatchStatus (F7 UI states)", () => {
  it("describes a collecting window with its fixed cutoff", () => {
    expect(pickBatchStatus([job("batch_a")], 3)).toEqual({
      jobId: "batch_a",
      state: "collecting",
      openedAt: new Date(1_000),
      closesAt: new Date(4_000),
      maxAttempts: 3,
    });
  });

  it("prefers the running job, and reports waiting-for-manual as waiting", () => {
    const running = job("batch_a", { queueState: "active", attemptsMade: 1 });
    const next = job("batch_b", { createdAt: 5_000, readyAt: 8_000 });
    expect(pickBatchStatus([next, running], 3)).toMatchObject({
      jobId: "batch_a",
      state: "generating",
      attempt: 2,
    });
    expect(pickBatchStatus([{ ...running, phase: "waiting" }], 3)).toMatchObject({
      state: "waiting",
    });
  });

  it("describes a retry wait with the next attempt", () => {
    const retrying = job("batch_a", { attemptsMade: 1, nextAttemptAt: 9_000, readyAt: 9_000 });
    expect(pickBatchStatus([retrying], 3)).toMatchObject({
      state: "retry_wait",
      nextAttemptAt: new Date(9_000),
      attempt: 2,
      maxAttempts: 3,
    });
  });

  it("is null without jobs", () => {
    expect(pickBatchStatus([], 3)).toBeNull();
  });
});

describe("hasNewerReadyJob (F7 rule 5)", () => {
  const current = job("batch_a", { queueState: "active" });
  it("is true only for a newer job that is ready", () => {
    expect(
      hasNewerReadyJob(current, [job("batch_b", { createdAt: 2_000, readyAt: 5_000 })], 4_999),
    ).toBe(false);
    expect(
      hasNewerReadyJob(current, [job("batch_b", { createdAt: 2_000, readyAt: 5_000 })], 5_000),
    ).toBe(true);
    expect(
      hasNewerReadyJob(current, [job("batch_b", { createdAt: 2_000, queueState: "waiting" })], 0),
    ).toBe(true);
    expect(
      hasNewerReadyJob(current, [job("batch_z", { createdAt: 500, queueState: "waiting" })], 9_000),
    ).toBe(false);
  });
});
