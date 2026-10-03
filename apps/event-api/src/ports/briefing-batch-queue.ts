import type { EventId, RunId } from "@event-desk/contracts";
import type { BatchJobState, BatchJobStatus } from "../modules/generation/domain/batch-jobs.js";

// The status types live in the pure domain module (domain code may not import ports; ports may
// import domain types) and are re-exported here.
export type { BatchJobState, BatchJobStatus };

/** One execution of a batch job, as the processor sees it. Queue mechanics stay in the adapter. */
export interface BatchJobContext {
  runId: RunId;
  eventId: EventId;
  /** 1-based. */
  attempt: number;
  maxAttempts: number;
  /** The first attempt's start: the execution deadline counts from here (F7). */
  firstStartedAt: Date;
  /** An earlier execution persisted "sending" and never settled: it stopped mid-call (T5 §3, S-4). */
  interruptedWhileSending: boolean;
  /** Persisted before the Gateway write, and cleared once its result is known. */
  markSending(): Promise<void>;
  markSettled(): Promise<void>;
  /** "waiting" while a manual generation runs (F7 "Waiting"), then "generating". */
  reportPhase(phase: "waiting" | "generating"): Promise<void>;
  /** A newer job for the same event is ready to run, so this one is redundant (F7 rule 5). */
  hasNewerReadyJob(): Promise<boolean>;
}

export type BatchStep = { kind: "done" } | { kind: "retry"; delayMs: number };

export interface BatchJobHandler {
  handle(job: BatchJobContext): Promise<BatchStep>;
  /** An unexpected error ended the job's last attempt: record that it failed. */
  abandoned(job: { runId: RunId; eventId: EventId }): Promise<void>;
  /** A queue-side state change the UI should see: started, retry wait, finished. */
  stateChanged(eventId: EventId): Promise<void>;
}

export interface BriefingBatchQueue {
  /** Joins the event's open window or opens one; the cutoff never moves. Rejects if the queue store is unreachable. */
  schedule(eventId: EventId): Promise<void>;
  /** The job the UI should describe, or null. Rejects if the store is unreachable. */
  status(eventId: EventId): Promise<BatchJobStatus | null>;
  /** Starts the single worker (concurrency 1). */
  start(handler: BatchJobHandler): void;
  /** Closes the worker (waiting for its active job) and the connections. */
  close(): Promise<void>;
}
