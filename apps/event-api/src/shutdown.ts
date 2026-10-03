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
 * The SIGTERM/SIGINT handler: end live streams, stop accepting connections, close the stores, exit. A second
 * signal is logged and ignored, so it neither kills a shutdown in progress nor closes twice.
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
