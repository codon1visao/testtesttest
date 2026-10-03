import type { Logger } from "./shared/logger.js";

export interface ShutdownDeps {
  logger: Logger;
  server: { close(done: () => void): unknown };
  /**
   * Starts at the signal, before the HTTP server closes: ends live streams (which would otherwise
   * keep it open), stops new batch work and drains manual runs. Self-bounded.
   */
  stopWork: () => Promise<void>;
  /** Runs once the work above and the HTTP server's close have both finished. */
  closeStores: () => Promise<void>;
  exit: (code: number) => void;
  graceMs: number;
}

/**
 * The SIGTERM/SIGINT handler (T3 §10). At the signal it stops the API's work and stops accepting
 * connections at the same time: an in-flight request (a manual Generate can take a minute) must
 * not keep the batch worker starting paid calls. The stores close only after both finish; the
 * grace timer bounds a request that never ends. A second signal is logged and ignored, so it
 * neither kills a shutdown in progress nor closes twice.
 */
export function gracefulShutdown(deps: ShutdownDeps): (signal: NodeJS.Signals) => void {
  const { logger, server, stopWork, closeStores, exit, graceMs } = deps;
  let shuttingDown = false;
  return (signal) => {
    if (shuttingDown) {
      logger.warn({ signal }, "already shutting down; signal ignored");
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    setTimeout(() => {
      exit(1);
    }, graceMs).unref();
    const work = stopWork();
    const httpClosed = new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    void Promise.all([work, httpClosed])
      .then(() => closeStores())
      .then(
        () => {
          exit(0);
        },
        (error: unknown) => {
          logger.error({ err: error }, "shutdown failed");
          exit(1);
        },
      );
  };
}

/** What the event API holds open, in the terms the close sequence needs. */
export interface ApiResources {
  logger: Logger;
  stopStreams(): void;
  /** Self-bounded (worker 5 s, then producer 2 s). */
  closeBatchQueue(): Promise<void>;
  /** Every in-flight manual generation has recorded its outcome. */
  whenManualIdle(): Promise<void>;
  manualDrainMs: number;
  closeRedis(): void;
  closeDatabase(): Promise<void>;
}

/**
 * The first half of the close sequence (T3 §10): end live streams; close the batch queue (its
 * closing flag is set synchronously, so the running job starts no Gateway call) while in-flight
 * manual runs drain, in parallel, so the worst case is the longer of the two, inside the grace
 * period. Never rejects: a failure is logged so the stores still close.
 */
export async function stopApiWork(resources: ApiResources): Promise<void> {
  const { logger } = resources;
  resources.stopStreams();
  let drainTimer: NodeJS.Timeout | undefined;
  const drainBound = new Promise<"timed-out">((resolve) => {
    drainTimer = setTimeout(() => {
      resolve("timed-out");
    }, resources.manualDrainMs);
  });
  const [queue, manual] = await Promise.allSettled([
    resources.closeBatchQueue(),
    Promise.race([resources.whenManualIdle(), drainBound]),
  ]);
  clearTimeout(drainTimer);
  if (queue.status === "rejected") {
    logger.error({ err: queue.reason }, "batch queue did not close cleanly");
  }
  if (manual.status === "rejected") {
    logger.error({ err: manual.reason }, "manual generations did not drain cleanly");
  } else if (manual.value === "timed-out") {
    logger.warn(
      { timeoutMs: resources.manualDrainMs },
      "manual generations still running at shutdown; their outcomes may not be recorded",
    );
  }
}

/** The second half: always close Redis and MySQL, even when closing the queue failed. */
export async function closeApiStores(resources: ApiResources): Promise<void> {
  resources.closeRedis();
  await resources.closeDatabase();
}

/** The whole close sequence, for callers that hold no HTTP server of their own (tests). */
export async function closeApiResources(resources: ApiResources): Promise<void> {
  await stopApiWork(resources);
  await closeApiStores(resources);
}
