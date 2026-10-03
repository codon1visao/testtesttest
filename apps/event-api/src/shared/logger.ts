import { type DestinationStream, type Logger, pino } from "pino";

export type { Logger };

/** Owned here (not in config/) because shared/ is a leaf that imports nothing else in the app. */
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

/** Error properties that can carry SQL text, Redis command arguments or feedback content (S1: never log raw notes). */
export const REDACTED_PATHS = [
  "err.query",
  "err.parameters",
  "err.driverError.sql",
  "err.command.args",
  "err.cause.query",
  "err.cause.parameters",
  "err.cause.driverError.sql",
  "err.cause.command.args",
];

export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: "event-api" },
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}
