import { Redis } from "ioredis";
import type { Logger } from "../shared/logger.js";

/**
 * Cache client that fails fast: with the offline queue disabled, a command issued while Redis
 * is down errors immediately instead of waiting, so reads fall back to MySQL without stalling.
 */
export function createRedisClient(url: string, logger: Logger): Redis {
  const client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    commandTimeout: 1_000,
    retryStrategy: (attempt: number) => Math.min(attempt * 250, 2_000),
  });
  let reportedDown = false;
  client.on("ready", () => {
    if (reportedDown) logger.info("redis reconnected");
    reportedDown = false;
  });
  client.on("error", (error: Error) => {
    if (reportedDown) return;
    reportedDown = true;
    logger.warn({ err: error }, "redis unavailable; serving event reads from MySQL");
  });
  return client;
}

/**
 * Resolves once the first connection attempt has settled (ready, failed or closed), at most
 * `timeoutMs` later. Never rejects: with the offline queue disabled, commands issued before the
 * socket is ready would be reported as an outage, so the composition root waits for this once.
 */
export function settleInitialConnection(client: Redis, timeoutMs = 1_000): Promise<void> {
  if (client.status === "ready") return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      client.off("ready", done);
      client.off("error", done);
      client.off("close", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    client.once("ready", done);
    client.once("error", done);
    client.once("close", done);
  });
}
