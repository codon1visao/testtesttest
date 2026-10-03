import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { z } from "zod";
import type { LogLevel } from "../shared/logger.js";

const csv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    );

const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const satisfies readonly LogLevel[];

const EnvObject = z.object({
  HOST: z
    .enum(["127.0.0.1", "::1", "localhost"], { error: "HOST must be a loopback address" })
    .default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  MYSQL_URL: z.url({ protocol: /^mysql$/, error: "must be a mysql:// URL" }),
  REDIS_URL: z
    .url({ protocol: /^redis$/, error: "must be a redis:// URL" })
    .default("redis://127.0.0.1:6379/0"),
  ALLOWED_ORIGINS: csv("http://localhost:5173"),
  ALLOWED_HOSTS: csv("localhost,127.0.0.1,[::1]"),
  EVENT_VIEW_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(30_000),
  MYSQL_QUERY_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  GATEWAY_HOST: z
    .enum(["127.0.0.1", "::1", "localhost"], { error: "GATEWAY_HOST must be a loopback address" })
    .default("127.0.0.1"),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  GATEWAY_SERVICE_SECRET: z
    .string({ error: "is required" })
    .refine((value) => Buffer.byteLength(value, "utf8") >= 32, {
      message: "must be at least 32 bytes",
    }),
  /** Capped below the web app's 90 s request timeout so the server always answers first. */
  MANUAL_GENERATION_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(85_000).default(60_000),
  /** Paid attempts per event and UTC day, manual and batch together (F7). */
  GENERATION_DAILY_ATTEMPT_LIMIT: z.coerce.number().int().min(1).max(1_000).default(20),
  /** The part of the daily total that automatic batches may use. */
  GENERATION_BATCH_DAILY_LIMIT: z.coerce.number().int().min(0).max(1_000).default(15),
});

const EnvSchema = EnvObject.superRefine((env, ctx) => {
  if (env.GENERATION_BATCH_DAILY_LIMIT > env.GENERATION_DAILY_ATTEMPT_LIMIT) {
    ctx.addIssue({
      code: "custom",
      path: ["GENERATION_BATCH_DAILY_LIMIT"],
      message: "must not exceed GENERATION_DAILY_ATTEMPT_LIMIT",
    });
  }
});

/** Derived from the schema so the `.env` allowlist cannot drift from what the config reads. */
const DOT_ENV_KEYS: readonly string[] = Object.keys(EnvObject.shape);

export interface AppConfig {
  host: string;
  port: number;
  mysqlUrl: string;
  redisUrl: string;
  allowedOrigins: string[];
  allowedHosts: string[];
  eventViewCacheTtlMs: number;
  /** Per-query deadline; also bounds lock waits and waiting for a pooled connection. */
  mysqlQueryTimeoutMs: number;
  logLevel: LogLevel;
  /** The AI Gateway's loopback TCP endpoint and the shared service secret (F8). */
  gateway: { host: string; port: number; secret: string };
  /** Deadline of one manual generation call (F4); the Gateway answers a margin before it. */
  manualGenerationTimeoutMs: number;
  /** Daily paid attempts per event: the total, and the share automatic batches may use (F7). */
  generationLimits: { dailyAttempts: number; batchDailyAttempts: number };
}

/** Invalid configuration. The message names variables and problems, never their values. */
export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid event-api configuration:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`),
    );
  }
  const e = result.data;
  return {
    host: e.HOST,
    port: e.PORT,
    mysqlUrl: e.MYSQL_URL,
    redisUrl: e.REDIS_URL,
    allowedOrigins: e.ALLOWED_ORIGINS,
    allowedHosts: e.ALLOWED_HOSTS,
    eventViewCacheTtlMs: e.EVENT_VIEW_CACHE_TTL_MS,
    mysqlQueryTimeoutMs: e.MYSQL_QUERY_TIMEOUT_MS,
    logLevel: e.LOG_LEVEL,
    gateway: { host: e.GATEWAY_HOST, port: e.GATEWAY_PORT, secret: e.GATEWAY_SERVICE_SECRET },
    manualGenerationTimeoutMs: e.MANUAL_GENERATION_TIMEOUT_MS,
    generationLimits: {
      dailyAttempts: e.GENERATION_DAILY_ATTEMPT_LIMIT,
      batchDailyAttempts: e.GENERATION_BATCH_DAILY_LIMIT,
    },
  };
}

/**
 * Loads the repository's `.env` if it exists, copying in only this app's own keys (S1-12): one
 * shared file must not hand the OpenAI key (or any other service's secrets) to this process. Variables already set in the environment win.
 */
export function loadDotEnv(path: URL, env: NodeJS.ProcessEnv = process.env): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  const parsed = parseEnv(content);
  for (const key of DOT_ENV_KEYS) {
    const value = parsed[key];
    if (value !== undefined && env[key] === undefined) env[key] = value;
  }
}
