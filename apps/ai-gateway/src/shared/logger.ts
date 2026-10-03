import { type DestinationStream, type Logger, pino } from "pino";

export type { Logger };
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

/**
 * Second layer only (S1). The first layer is discipline: log scalar metadata (IDs, lane, code,
 * model, prompt version, usage, durations), never request input, model output, secrets or raw
 * provider/SDK errors — SDK error messages can embed model text such as a refusal.
 */
export const REDACTED_PATHS = [
  "auth",
  "*.auth",
  "input",
  "*.input",
  "sections",
  "*.sections",
  "apiKey",
  "*.apiKey",
];

export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: "ai-gateway" },
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}
