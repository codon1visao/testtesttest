import { FeedbackIdSchema, RunIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import {
  hasNewerReadyJob,
  pickBatchStatus,
  type QueuedBatchJob,
  toBatchStatusView,
} from "./batch-jobs.js";

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
    const running = job("batch_a", { queueState: "active", attemptsMade: 1, phase: "generating" });
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

  it("M5: an active job that has not reported a phase yet is waiting, not generating", () => {
    const started = job("batch_a", { queueState: "active", attemptsMade: 0 });
    expect(pickBatchStatus([started], 3)).toMatchObject({ state: "waiting", attempt: 1 });
    expect(pickBatchStatus([{ ...started, phase: "generating" }], 3)).toMatchObject({
      state: "generating",
      attempt: 1,
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

describe("toBatchStatusView (F7 'Collecting' text input)", () => {
  const note = (id: string, receivedAt: string) => ({
    id: FeedbackIdSchema.parse(id),
    text: "x",
    receivedAt,
  });
  const notes = [
    note("F08", "2026-10-04T09:00:00.000Z"),
    note("F10", "2026-10-04T10:00:01.000Z"),
    note("F09", "2026-10-04T10:00:00.000Z"),
  ];
  it("lists the notes received since the window's first note, in ID order", () => {
    const status = {
      jobId: RunIdSchema.parse("batch_a"),
      state: "collecting" as const,
      openedAt: new Date("2026-10-04T10:00:00.050Z"),
      closesAt: new Date("2026-10-04T10:00:03.050Z"),
      maxAttempts: 3,
    };
    expect(toBatchStatusView(status, notes, new Date("2026-10-04T10:00:00.000Z"))).toEqual({
      state: "collecting",
      jobId: "batch_a",
      closesAt: "2026-10-04T10:00:03.050Z",
      maxAttempts: 3,
      newNoteIds: ["F09", "F10"],
    });
  });
  it("is null without a job and lists nothing without a pending flag", () => {
    expect(toBatchStatusView(null, notes, null)).toBeNull();
    const generating = {
      jobId: RunIdSchema.parse("batch_a"),
      state: "generating" as const,
      openedAt: new Date(0),
      attempt: 1,
      maxAttempts: 3,
    };
    expect(toBatchStatusView(generating, notes, null)).toMatchObject({
      state: "generating",
      attempt: 1,
      newNoteIds: [],
    });
  });
  it("M3/P12: new notes belong to a collecting window only", () => {
    const pendingSince = new Date("2026-10-04T10:00:00.000Z");
    for (const state of ["waiting", "generating", "retry_wait"] as const) {
      const status = {
        jobId: RunIdSchema.parse("batch_a"),
        state,
        openedAt: new Date(0),
        maxAttempts: 3,
      };
      expect(toBatchStatusView(status, notes, pendingSince)?.newNoteIds).toEqual([]);
    }
  });
});
