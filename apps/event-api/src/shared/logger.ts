import { type DestinationStream, type Logger, pino } from "pino";

export type { Logger };

/** Owned here (not in config/) because shared/ is a leaf that imports nothing else in the app. */
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

/**
 * Error properties that carry SQL text (with parameters interpolated), SQL parameters, the wrapped
 * driver error or Redis command arguments. TypeORM's QueryFailedError copies the mysql2 error's own
 * properties (`sql`, `sqlMessage`) onto itself, and ioredis attaches `command.args` (S1: never log
 * raw notes). `code`, `errno`, `type`, `message` and `stack` stay: MySQL messages carry no parameters.
 */
const SENSITIVE_ERROR_FIELDS: ReadonlySet<string> = new Set([
  "sql",
  "sqlMessage",
  "query",
  "parameters",
  "driverError",
  "command",
]);

const MAX_DEPTH = 6;

/** Copies a value without sensitive fields at every depth (causes, aggregated errors, nested objects). */
function scrub(value: unknown, depth: number): unknown {
  if (value instanceof Error) return serializeErrorAt(value, depth);
  if (typeof value !== "object" || value === null || value instanceof Date) return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((item: unknown) => scrub(item, depth + 1));
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!SENSITIVE_ERROR_FIELDS.has(key)) copy[key] = scrub(entry, depth + 1);
  }
  return copy;
}

function serializeErrorAt(error: Error, depth: number): Record<string, unknown> {
  if (depth >= MAX_DEPTH) return { type: error.name, message: "[truncated]" };
  // pino's standard serializer folds cause messages into `message` and cause stacks into `stack`,
  // copies the other enumerable properties and lists AggregateError members as `aggregateErrors`
  // (the raw `errors` array it also copies is dropped: those are unserialised Error objects).
  const { errors: _rawErrors, ...standard }: Record<string, unknown> =
    pino.stdSerializers.err(error);
  const serialized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(standard)) {
    if (!SENSITIVE_ERROR_FIELDS.has(key)) serialized[key] = scrub(entry, depth + 1);
  }
  // The standard serializer skips an Error cause's own fields (code, errno): keep them, scrubbed.
  // The cause's stack is already in the parent's stack ("caused by: …").
  if (error.cause instanceof Error) {
    const { stack: _stack, ...cause } = serializeErrorAt(error.cause, depth + 1);
    serialized.cause = cause;
  } else if (error.cause !== undefined) {
    serialized.cause = scrub(error.cause, depth + 1);
  }
  return serialized;
}

/** The `err` serializer: pino's standard one, then sensitive fields removed at every level. */
export function serializeError(value: unknown): unknown {
  return scrub(value, 0);
}

/** Second layer behind the serializer, for error-shaped objects logged under `err`. */
export const REDACTED_PATHS = [
  "err.query",
  "err.parameters",
  "err.sql",
  "err.driverError.sql",
  "err.command.args",
];

export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: "event-api" },
    serializers: { err: serializeError },
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}
