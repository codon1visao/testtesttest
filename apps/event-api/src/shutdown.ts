import type { Logger } from "./shared/logger.js";

export interface ShutdownDeps {
  logger: Logger;
  server: { close(done: () => void): unknown };
  closeApi: () => Promise<void>;
  exit: (code: number) => void;
  graceMs: number;
  /** Runs before the HTTP server closes: ends live streams, which would otherwise keep it open. */
  beforeClose?: () => void;
}

/**
 * The SIGTERM/SIGINT handler: end live streams, stop accepting connections, close the stores,
 * exit. A second signal is logged and ignored, so it neither kills a shutdown in progress nor
 * closes twice.
 */
export function gracefulShutdown(deps: ShutdownDeps): (signal: NodeJS.Signals) => void {
  const { logger, server, closeApi, exit, graceMs, beforeClose } = deps;
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
    beforeClose?.();
    server.close(() => {
      void closeApi().then(
        () => {
          exit(0);
        },
        (error: unknown) => {
          logger.error({ err: error }, "shutdown failed");
          exit(1);
        },
      );
    });
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
 * The close sequence (T3 §10): end live streams; close the batch queue while in-flight manual
 * runs drain (in parallel, so the worst case is the longer of the two, inside the grace period);
 * then always close Redis and MySQL, even when closing the queue failed.
 */
export async function closeApiResources(resources: ApiResources): Promise<void> {
  const { logger } = resources;
  resources.stopStreams();
  let drainTimer: NodeJS.Timeout | undefined;
  const drainBound = new Promise<void>((resolve) => {
    drainTimer = setTimeout(resolve, resources.manualDrainMs);
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
  }
  resources.closeRedis();
  await resources.closeDatabase();
}
