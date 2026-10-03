import { z } from "zod";
import type { LogLevel } from "../shared/logger.js";

const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const satisfies readonly LogLevel[];
const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** A copied .env.example leaves optional variables empty: treat "" as unset. */
const blankAsUnset = (value: unknown) => (value === "" ? undefined : value);

const EnvSchema = z
  .object({
    GATEWAY_HOST: z
      .enum(["127.0.0.1", "::1", "localhost"], { error: "must be a loopback address" })
      .default("127.0.0.1"),
    GATEWAY_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
    GATEWAY_SERVICE_SECRET: z
      .string({ error: "is required" })
      .refine((value) => Buffer.byteLength(value, "utf8") >= 32, {
        message: "must be at least 32 bytes",
      }),
    OPENAI_API_KEY: z.preprocess(blankAsUnset, z.string().trim().min(1).optional()),
    OPENAI_MODEL: z.preprocess(blankAsUnset, z.string().trim().min(1).max(100).optional()),
    OPENAI_REASONING_EFFORT: z.preprocess(blankAsUnset, z.enum(REASONING_EFFORTS).optional()),
    OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(50_000),
    MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(16_000).default(4_000),
    GATEWAY_MAX_CALL_MS: z.coerce.number().int().min(5_000).max(120_000).default(60_000),
    GATEWAY_RESPONSE_MARGIN_MS: z.coerce.number().int().min(100).max(10_000).default(1_000),
    GATEWAY_DAILY_CALL_LIMIT: z.coerce.number().int().min(1).max(10_000).default(40),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.OPENAI_API_KEY !== undefined && env.OPENAI_MODEL === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["OPENAI_MODEL"],
        message: "is required when OPENAI_API_KEY is set",
      });
    }
  });

export interface ProviderConfig {
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffort | undefined;
  /** HTTP timeout of the OpenAI client; the request deadline still aborts earlier when it is shorter. */
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface GatewayConfig {
  host: string;
  port: number;
  serviceSecret: string;
  /** null when no OPENAI_API_KEY is set: every call answers PROVIDER_NOT_CONFIGURED (F8). */
  provider: ProviderConfig | null;
  /** Ceiling on any request's deadline; callers cannot raise it (S1). */
  maxCallMs: number;
  /** The provider call is aborted this long before the deadline, leaving time to answer. */
  responseMarginMs: number;
  /** In-memory backstop on provider calls per UTC day; the event API owns the real budget. */
  dailyCallLimit: number;
  logLevel: LogLevel;
}

/** Invalid configuration. Problems name variables, never their values. */
export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid ai-gateway configuration:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`),
    );
  }
  const e = result.data;
  const provider =
    e.OPENAI_API_KEY !== undefined && e.OPENAI_MODEL !== undefined
      ? {
          apiKey: e.OPENAI_API_KEY,
          model: e.OPENAI_MODEL,
          reasoningEffort: e.OPENAI_REASONING_EFFORT,
          timeoutMs: e.OPENAI_TIMEOUT_MS,
          maxOutputTokens: e.MAX_OUTPUT_TOKENS,
        }
      : null;
  return {
    host: e.GATEWAY_HOST,
    port: e.GATEWAY_PORT,
    serviceSecret: e.GATEWAY_SERVICE_SECRET,
    provider,
    maxCallMs: e.GATEWAY_MAX_CALL_MS,
    responseMarginMs: e.GATEWAY_RESPONSE_MARGIN_MS,
    dailyCallLimit: e.GATEWAY_DAILY_CALL_LIMIT,
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
