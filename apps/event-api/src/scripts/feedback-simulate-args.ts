import { parseArgs } from "node:util";

export const DEFAULT_NOTES: readonly string[] = [
  "The walk was lovely and the pace felt right.",
  "More shade at the rest stop would help.",
  "Could the start time be posted a week earlier?",
  "I liked finishing at the café.",
  "The signs at the second junction were confusing.",
];

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface SimulateOptions {
  count: number;
  intervalMs: number;
  texts: string[];
  apiUrl: string;
  origin: string;
  eventId: string;
}

function integer(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new UsageError(`--${name} must be a whole number from ${String(min)} to ${String(max)}.`);
  }
  return value;
}

export function parseSimulateArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  readText: (path: string) => string,
): SimulateOptions {
  let values: { count?: string; "interval-ms"?: string; "text-file"?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        count: { type: "string" },
        "interval-ms": { type: "string" },
        "text-file": { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : "Invalid arguments.");
  }
  let texts = [...DEFAULT_NOTES];
  const file = values["text-file"];
  if (file !== undefined) {
    texts = readText(file)
      .split("\n")
      .filter((line) => line.trim().length > 0);
    if (texts.length === 0) {
      throw new UsageError(`${file} has no notes (one note per non-blank line).`);
    }
    if (texts.some((text) => Array.from(text).length > 1_000)) {
      throw new UsageError("Each note must be at most 1,000 characters.");
    }
  }
  const origin =
    (env.ALLOWED_ORIGINS ?? "http://localhost:5173").split(",")[0]?.trim() ??
    "http://localhost:5173";
  return {
    count: integer("count", values.count, 5, 1, 50),
    intervalMs: integer("interval-ms", values["interval-ms"], 200, 0, 60_000),
    texts,
    apiUrl: env.FEEDBACK_API_URL ?? `http://127.0.0.1:${env.PORT ?? "4000"}`,
    origin,
    eventId: "E101",
  };
}
