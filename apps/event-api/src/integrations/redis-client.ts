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
