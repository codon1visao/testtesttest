import { EventIdSchema, type EventId, RunIdSchema } from "@event-desk/contracts";
import { type Job, Queue, UnrecoverableError, Worker } from "bullmq";
import { z } from "zod";
import {
  hasNewerReadyJob,
  pickBatchStatus,
  type QueuedBatchJob,
} from "../modules/generation/domain/batch-jobs.js";
import type {
  BatchJobContext,
  BatchJobHandler,
  BatchJobStatus,
  BatchStep,
  BriefingBatchQueue,
} from "../ports/briefing-batch-queue.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { Logger } from "../shared/logger.js";
import { producerConnection, workerConnection } from "./bullmq-connection.js";

/** Default `bull` prefix: keys are `bull:briefing-batch:*`, which the reset deletes. */
const QUEUE_NAME = "briefing-batch";
const JOB_NAME = "briefing.batch";
/**
 * BullMQ waits for a connection's first "ready" without a deadline (it rejects only once the
 * client ends, and the retry strategy never ends it), so producer calls made while Redis has been
 * down since startup would hang. Once connected, `maxRetriesPerRequest: 1` makes them fail fast.
 */
const FIRST_CONNECTION_TIMEOUT_MS = 2_000;
/** `status` is read by every event view, which must answer quickly while Redis is down (T3 §7). */
const STATUS_FIRST_CONNECTION_TIMEOUT_MS = 250;

/**
 * Shutdown waits this long for the worker's active job, then this long for the producer
 * connection: 7 s at most, inside the 8 s manual drain that runs alongside (T3 §10).
 */
const WORKER_CLOSE_TIMEOUT_MS = 5_000;
const QUEUE_CLOSE_TIMEOUT_MS = 2_000;

/** True when `promise` resolves within `timeoutMs`; false when it is still pending. Rejections pass through. */
async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise.then(() => true), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Job payload: a pointer to the event plus execution markers; never candidate data (T5 §3). */
const JobDataSchema = z.object({
  eventId: EventIdSchema,
  dispatch: z.enum(["idle", "sending"]),
  phase: z.enum(["waiting", "generating"]).optional(),
  firstStartedAt: z.iso.datetime().optional(),
  nextAttemptAt: z.iso.datetime().optional(),
});
type JobData = z.infer<typeof JobDataSchema>;

/** Thrown for a handler's `retry` step: the backoff strategy reads its delay (spike S-3). */
class RetryDelayError extends Error {
  constructor(readonly delayMs: number) {
    super("batch attempt will retry");
    this.name = "RetryDelayError";
  }
}

export interface BullMqBatchQueueOptions {
  redisUrl: string;
  windowMs: number;
  maxAttempts: number;
  ids: Pick<IdGenerator, "batchRunId">;
  clock: Clock;
  logger: Logger;
  /**
   * Same for every worker of the queue (spike S-4 finding). Defaults: lock 30 s, stalled 30 s,
   * unexpected-error retry 5 s.
   */
  lockDurationMs?: number;
  stalledIntervalMs?: number;
  unexpectedRetryDelayMs?: number;
}

/** The BriefingBatchQueue adapter (T5 §3), verified by the spike in docs/spikes/bullmq-window.md. */
export class BullMqBriefingBatchQueue implements BriefingBatchQueue {
  private readonly queue: Queue<JobData>;
  private worker: Worker<JobData> | null = null;
  /** Both worker connections came up at least once, so it may hold a job. */
  private workerReady = false;
  /** close() has started: the running job must not start a Gateway call. */
  private closing = false;

  constructor(private readonly options: BullMqBatchQueueOptions) {
    this.queue = new Queue<JobData>(QUEUE_NAME, {
      connection: producerConnection(options.redisUrl),
    });
    this.queue.on("error", (error) => {
      options.logger.warn({ err: error }, "batch queue connection error");
    });
  }

  async schedule(eventId: EventId): Promise<void> {
    await this.connected();
    await this.queue.add(
      JOB_NAME,
      { eventId, dispatch: "idle" },
      {
        jobId: this.options.ids.batchRunId(),
        deduplication: { id: `briefing-batch-${eventId}`, ttl: this.options.windowMs },
        delay: this.options.windowMs,
        attempts: this.options.maxAttempts,
        backoff: { type: "handler-delay" },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    );
  }

  async status(eventId: EventId): Promise<BatchJobStatus | null> {
    await this.connected(STATUS_FIRST_CONNECTION_TIMEOUT_MS);
    return pickBatchStatus(await this.liveJobs(eventId), this.options.maxAttempts);
  }

  start(handler: BatchJobHandler): void {
    if (this.worker !== null) return;
    const { logger } = this.options;
    const notify = (eventId: EventId) => {
      handler.stateChanged(eventId).catch((error: unknown) => {
        logger.warn({ err: error, eventId }, "batch state change could not be published");
      });
    };
    const worker = new Worker<JobData>(QUEUE_NAME, (job) => this.process(job, handler, notify), {
      connection: workerConnection(this.options.redisUrl),
      concurrency: 1,
      lockDuration: this.options.lockDurationMs ?? 30_000,
      stalledInterval: this.options.stalledIntervalMs ?? 30_000,
      maxStalledCount: 1,
      settings: {
        backoffStrategy: (_attemptsMade: number, _type?: string, error?: Error) =>
          error instanceof RetryDelayError ? error.delayMs : this.unexpectedRetryDelayMs(),
      },
    });
    worker.once("ready", () => {
      this.workerReady = true;
    });
    worker.on("active", (job) => {
      const data = JobDataSchema.safeParse(job.data);
      if (data.success) notify(data.data.eventId);
    });
    worker.on("completed", (job) => {
      const data = JobDataSchema.safeParse(job.data);
      if (data.success) notify(data.data.eventId);
    });
    worker.on("failed", (job, error) => {
      if (job === undefined) return;
      const data = JobDataSchema.safeParse(job.data);
      // Our own UnrecoverableError (invalid data) has nothing to record: it never parses here.
      if (!data.success) return;
      // Terminal: no attempts left, or an UnrecoverableError. BullMQ 6 fails a job that stalled
      // more than maxStalledCount by setting a deferred failure and moving it back to wait; the
      // next worker to take it fails it with UnrecoverableError("job stalled more than
      // allowable limit") without running the processor, so that also arrives here.
      const terminal =
        error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
      // A retry step on the last attempt is a known failure the handler records itself.
      if (terminal && !(error instanceof RetryDelayError)) {
        logger.error(
          { err: error, runId: job.id },
          "batch job abandoned (unexpected errors or repeated stalls)",
        );
        const runId = RunIdSchema.safeParse(job.id);
        if (runId.success) {
          handler
            .abandoned({ runId: runId.data, eventId: data.data.eventId })
            .catch((recordError: unknown) => {
              logger.warn(
                { err: recordError, runId: job.id },
                "abandoned batch could not be recorded",
              );
            });
        }
      }
      notify(data.data.eventId);
    });
    // A stalled job went back to wait: it runs again, or fails as above on its second stall.
    worker.on("stalled", (jobId) => {
      logger.warn({ runId: jobId }, "batch job stalled");
      void this.eventOf(jobId).then(
        (eventId) => {
          if (eventId !== null) notify(eventId);
        },
        (error: unknown) => {
          logger.warn({ err: error, runId: jobId }, "stalled batch job could not be read");
        },
      );
    });
    worker.on("error", (error) => {
      logger.warn({ err: error }, "batch worker error");
    });
    this.worker = worker;
  }

  /**
   * Tells the running job that shutdown has started, waits up to 5 s for it, then stops waiting:
   * BullMQ 6.3.11's `close(true)` after a pending graceful close returns that same promise, so
   * forcing cannot shorten it. An abandoned job keeps its lock until the process exits, then
   * stalls and re-runs with its dispatch marker (the crash path, T5 §3). The producer connection
   * then gets 2 s.
   */
  async close(): Promise<void> {
    const { logger } = this.options;
    this.closing = true;
    try {
      // BullMQ also waits forever for worker connections that never came up; a worker that never
      // connected holds no job: force it.
      const worker = this.worker?.close(!this.workerReady);
      if (worker !== undefined && !(await settlesWithin(worker, WORKER_CLOSE_TIMEOUT_MS))) {
        logger.warn(
          { timeoutMs: WORKER_CLOSE_TIMEOUT_MS },
          "batch worker still busy at shutdown; its job will re-run after a stall",
        );
      }
    } finally {
      if (!(await settlesWithin(this.queue.close(), QUEUE_CLOSE_TIMEOUT_MS))) {
        logger.warn({ timeoutMs: QUEUE_CLOSE_TIMEOUT_MS }, "batch queue did not close in time");
      }
    }
  }

  private async eventOf(jobId: string): Promise<EventId | null> {
    const job = await this.queue.getJob(jobId);
    const data = JobDataSchema.safeParse(job?.data);
    return data.success ? data.data.eventId : null;
  }

  /** Rejects when the producer connection has not become ready within the deadline. */
  private async connected(timeoutMs = FIRST_CONNECTION_TIMEOUT_MS): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error("batch queue store unreachable"));
      }, timeoutMs);
    });
    try {
      await Promise.race([this.queue.waitUntilReady(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async process(
    job: Job<JobData>,
    handler: BatchJobHandler,
    notify: (eventId: EventId) => void,
  ): Promise<void> {
    const parsed = JobDataSchema.safeParse(job.data);
    const runId = RunIdSchema.safeParse(job.id);
    if (!parsed.success || !runId.success) throw new UnrecoverableError("invalid batch job data");
    const interruptedWhileSending = parsed.data.dispatch === "sending";
    const firstStartedAt = parsed.data.firstStartedAt ?? this.options.clock.now().toISOString();
    // Every execution starts without a phase: a stale "waiting" from a stopped execution must not
    // carry into this one.
    const { phase: stalePhase, ...fresh } = parsed.data;
    let data: JobData = { ...fresh, firstStartedAt };
    if (parsed.data.firstStartedAt === undefined || stalePhase !== undefined) {
      await job.updateData(data);
    }
    const update = async (patch: Partial<JobData>) => {
      data = { ...data, ...patch };
      await job.updateData(data);
    };
    const context: BatchJobContext = {
      runId: runId.data,
      eventId: data.eventId,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? this.options.maxAttempts,
      firstStartedAt: new Date(firstStartedAt),
      interruptedWhileSending,
      markSending: () => update({ dispatch: "sending" }),
      markSettled: () => update({ dispatch: "idle" }),
      reportPhase: async (phase) => {
        await update({ phase });
        notify(data.eventId);
      },
      hasNewerReadyJob: async () => {
        const jobs = await this.liveJobs(data.eventId);
        const current = jobs.find((candidate) => candidate.jobId === runId.data);
        return (
          current !== undefined &&
          hasNewerReadyJob(current, jobs, this.options.clock.now().getTime())
        );
      },
      isShuttingDown: () => this.closing,
    };
    let step: BatchStep;
    try {
      step = await handler.handle(context);
    } catch (error) {
      // An unexpected error retries after unexpectedRetryDelayMs: record when, for the UI.
      if (!(error instanceof UnrecoverableError) && context.attempt < context.maxAttempts) {
        try {
          await this.saveNextAttempt(job, data, this.unexpectedRetryDelayMs());
        } catch (saveError) {
          this.options.logger.warn(
            { err: saveError, runId: job.id },
            "batch retry time could not be saved",
          );
        }
      }
      throw error;
    }
    if (step.kind === "retry") {
      await this.saveNextAttempt(job, data, step.delayMs);
      throw new RetryDelayError(step.delayMs);
    }
  }

  private unexpectedRetryDelayMs(): number {
    return this.options.unexpectedRetryDelayMs ?? 5_000;
  }

  /** Before a retry: when the next attempt starts, and no phase (the job is not running). */
  private async saveNextAttempt(job: Job<JobData>, data: JobData, delayMs: number): Promise<void> {
    const { phase: _phase, ...rest } = data;
    await job.updateData({
      ...rest,
      nextAttemptAt: new Date(this.options.clock.now().getTime() + delayMs).toISOString(),
    });
  }

  /** The event's not-yet-finished jobs, reduced to what the rules need. */
  private async liveJobs(eventId: EventId): Promise<QueuedBatchJob[]> {
    const jobs: QueuedBatchJob[] = [];
    for (const queueState of ["active", "delayed", "waiting"] as const) {
      for (const job of await this.queue.getJobs(queueState)) {
        const data = JobDataSchema.safeParse(job.data);
        const jobId = RunIdSchema.safeParse(job.id);
        if (!data.success || !jobId.success || data.data.eventId !== eventId) continue;
        const nextAttemptAt =
          data.data.nextAttemptAt === undefined ? undefined : Date.parse(data.data.nextAttemptAt);
        // On a retry BullMQ sets `delay` to the retry delay but keeps `timestamp` at creation, so
        // a retried job's ready time is the persisted next attempt, not timestamp + delay.
        const retrying = queueState === "delayed" && job.attemptsMade > 0;
        jobs.push({
          jobId: jobId.data,
          queueState,
          createdAt: job.timestamp,
          readyAt:
            retrying && nextAttemptAt !== undefined ? nextAttemptAt : job.timestamp + job.delay,
          attemptsMade: job.attemptsMade,
          ...(data.data.phase === undefined ? {} : { phase: data.data.phase }),
          ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
        });
      }
    }
    return jobs;
  }
}
