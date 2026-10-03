import {
  assertNever,
  compareFeedbackIds,
  type FeedbackNote,
  type GenerationStatusView,
  type RunId,
} from "@event-desk/contracts";

export type BatchJobState = "collecting" | "waiting" | "generating" | "retry_wait";

/** The live batch job the UI should describe (T5 §3 "Status for the UI"). */
export interface BatchJobStatus {
  jobId: RunId;
  state: BatchJobState;
  /** When the window opened: the schedule call that created the job. */
  openedAt: Date;
  /** collecting: the fixed cutoff. */
  closesAt?: Date;
  /** retry_wait: when the next attempt starts. */
  nextAttemptAt?: Date;
  /** generating / retry_wait: the attempt running or next (1-based). */
  attempt?: number;
  maxAttempts: number;
}

/** F7: at most 3 attempts within a 5-minute execution deadline. */
export const BATCH_MAX_ATTEMPTS = 3;
export const BATCH_EXECUTION_DEADLINE_MS = 5 * 60_000;

/** A queue job reduced to what the rules need; the adapter builds these from BullMQ jobs. */
export interface QueuedBatchJob {
  jobId: RunId;
  queueState: "active" | "delayed" | "waiting";
  /** ms */
  createdAt: number;
  /** ms: createdAt + delay for a delayed job, createdAt otherwise. */
  readyAt: number;
  attemptsMade: number;
  phase?: "waiting" | "generating";
  /** ms, set by the adapter before a retry. */
  nextAttemptAt?: number;
}

const RANK: Record<BatchJobState, number> = {
  generating: 4,
  waiting: 3,
  retry_wait: 2,
  collecting: 1,
};

function describe(job: QueuedBatchJob, maxAttempts: number): BatchJobStatus {
  const base = { jobId: job.jobId, openedAt: new Date(job.createdAt), maxAttempts };
  switch (job.queueState) {
    case "active":
      return {
        ...base,
        state: job.phase === "waiting" ? "waiting" : "generating",
        attempt: job.attemptsMade + 1,
      };
    case "delayed":
      return job.attemptsMade === 0
        ? { ...base, state: "collecting", closesAt: new Date(job.readyAt) }
        : {
            ...base,
            state: "retry_wait",
            nextAttemptAt: new Date(job.nextAttemptAt ?? job.readyAt),
            attempt: job.attemptsMade + 1,
          };
    case "waiting":
      return { ...base, state: "waiting" };
    default:
      return assertNever(job.queueState, "queue state");
  }
}

/** The one batch state the UI shows: the most advanced job, newest first on ties. */
export function pickBatchStatus(
  jobs: readonly QueuedBatchJob[],
  maxAttempts: number,
): BatchJobStatus | null {
  let best: BatchJobStatus | null = null;
  for (const job of jobs.toSorted((a, b) => b.createdAt - a.createdAt)) {
    const status = describe(job, maxAttempts);
    if (best === null || RANK[status.state] > RANK[best.state]) best = status;
  }
  return best;
}

/** F7 rule 5: a newer job that is ready to run makes `current` redundant. */
export function hasNewerReadyJob(
  current: QueuedBatchJob,
  others: readonly QueuedBatchJob[],
  now: number,
): boolean {
  return others.some(
    (job) =>
      job.jobId !== current.jobId &&
      job.createdAt > current.createdAt &&
      (job.queueState === "waiting" || (job.queueState === "delayed" && job.readyAt <= now)),
  );
}

/**
 * The contract shape of a batch job (T3 §5 GenerationStatusView). The window's new notes are those
 * received since the pending flag was set: the window's first note sets it and the job clears it
 * when it captures its input (T4 TX9/TX10), so these are exactly the notes the window holds.
 */
export function toBatchStatusView(
  status: BatchJobStatus | null,
  notes: readonly FeedbackNote[],
  pendingSince: Date | null,
): GenerationStatusView["batch"] {
  if (status === null) return null;
  const since = pendingSince?.getTime();
  const newNoteIds =
    since === undefined
      ? []
      : notes
          .filter((note) => Date.parse(note.receivedAt) >= since)
          .map((note) => note.id)
          .toSorted(compareFeedbackIds);
  return {
    state: status.state,
    jobId: status.jobId,
    ...(status.closesAt === undefined ? {} : { closesAt: status.closesAt.toISOString() }),
    ...(status.nextAttemptAt === undefined
      ? {}
      : { nextAttemptAt: status.nextAttemptAt.toISOString() }),
    ...(status.attempt === undefined ? {} : { attempt: status.attempt }),
    maxAttempts: status.maxAttempts,
    newNoteIds,
  };
}
