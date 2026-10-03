import type { AppConfig } from "../config/env.js";
import { createLogger } from "../shared/logger.js";

export const testMysqlUrl = (): string =>
  process.env.TEST_MYSQL_URL ??
  "mysql://event_desk:event_desk_local@127.0.0.1:3306/event_desk_test";
export const testRedisUrl = (): string => process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/1";

export const silentLogger = createLogger("silent");

export function integrationConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    mysqlUrl: testMysqlUrl(),
    redisUrl: testRedisUrl(),
    allowedOrigins: ["http://localhost:5173"],
    allowedHosts: ["127.0.0.1", "localhost"],
    eventViewCacheTtlMs: 30_000,
    mysqlQueryTimeoutMs: 5_000,
    logLevel: "silent",
    gateway: { host: "127.0.0.1", port: 1, secret: "event-api-test-secret-".padEnd(40, "s") },
    manualGenerationTimeoutMs: 10_000,
    generationLimits: { dailyAttempts: 20, batchDailyAttempts: 15 },
    batchWindowMs: 300,
    ...overrides,
  };
}
