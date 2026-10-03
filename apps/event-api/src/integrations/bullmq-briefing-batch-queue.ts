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
    await this.connected();
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
          error instanceof RetryDelayError
            ? error.delayMs
            : (this.options.unexpectedRetryDelayMs ?? 5_000),
      },
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
      if (!data.success) return;
      const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
      if (
        exhausted &&
        !(error instanceof RetryDelayError) &&
        !(error instanceof UnrecoverableError)
      ) {
        logger.error({ err: error, runId: job.id }, "batch job abandoned after unexpected errors");
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
    worker.on("error", (error) => {
      logger.warn({ err: error }, "batch worker error");
    });
    this.worker = worker;
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }

  /** Rejects when the producer connection has not become ready within the deadline. */
  private async connected(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error("batch queue store unreachable"));
      }, FIRST_CONNECTION_TIMEOUT_MS);
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
    let data: JobData = parsed.data;
    const update = async (patch: Partial<JobData>) => {
      data = { ...data, ...patch };
      await job.updateData(data);
    };
    const interruptedWhileSending = data.dispatch === "sending";
    if (data.firstStartedAt === undefined) {
      await update({ firstStartedAt: this.options.clock.now().toISOString() });
    }
    const context: BatchJobContext = {
      runId: runId.data,
      eventId: data.eventId,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? this.options.maxAttempts,
      firstStartedAt: new Date(data.firstStartedAt ?? this.options.clock.now().toISOString()),
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
    };
    const step = await handler.handle(context);
    if (step.kind === "retry") {
      const { phase: _phase, ...rest } = data;
      data = {
        ...rest,
        nextAttemptAt: new Date(this.options.clock.now().getTime() + step.delayMs).toISOString(),
      };
      await job.updateData(data);
      throw new RetryDelayError(step.delayMs);
    }
  }

  /** The event's not-yet-finished jobs, reduced to what the rules need. */
  private async liveJobs(eventId: EventId): Promise<QueuedBatchJob[]> {
    const jobs: QueuedBatchJob[] = [];
    for (const queueState of ["active", "delayed", "waiting"] as const) {
      for (const job of await this.queue.getJobs(queueState)) {
        const data = JobDataSchema.safeParse(job.data);
        const jobId = RunIdSchema.safeParse(job.id);
        if (!data.success || !jobId.success || data.data.eventId !== eventId) continue;
        jobs.push({
          jobId: jobId.data,
          queueState,
          createdAt: job.timestamp,
          readyAt: job.timestamp + job.delay,
          attemptsMade: job.attemptsMade,
          ...(data.data.phase === undefined ? {} : { phase: data.data.phase }),
          ...(data.data.nextAttemptAt === undefined
            ? {}
            : { nextAttemptAt: Date.parse(data.data.nextAttemptAt) }),
        });
      }
    }
    return jobs;
  }
}
