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

const EnvSchema = z.object({
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
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

export interface AppConfig {
  host: string;
  port: number;
  mysqlUrl: string;
  redisUrl: string;
  allowedOrigins: string[];
  allowedHosts: string[];
  eventViewCacheTtlMs: number;
  logLevel: LogLevel;
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
    logLevel: e.LOG_LEVEL,
  };
}

/** Loads the repository's `.env` if it exists. Variables already set in the environment win. */
export function loadDotEnv(path: URL): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}
