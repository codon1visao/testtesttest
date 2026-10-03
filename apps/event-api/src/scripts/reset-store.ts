import { Redis } from "ioredis";
import { type Connection, createConnection } from "mysql2/promise";
import { deleteKeysByPrefix } from "../integrations/delete-keys-by-prefix.js";
import { APPLICATION_KEY_PREFIXES } from "../integrations/redis-keys.js";

/** Reset refuses rather than guesses: a running API, or a database it does not own. */
export class ResetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResetRefusedError";
  }
}

/** The reset failed after the database may already have been dropped; running it again completes it. */
export class ResetIncompleteError extends Error {
  constructor(database: string, cause: unknown) {
    super(
      `The reset did not finish and the database "${database}" may already have been dropped. Run pnpm db:reset again. (${cause instanceof Error ? cause.message : "unknown error"})`,
      { cause },
    );
    this.name = "ResetIncompleteError";
  }
}

const RESETTABLE_DATABASES = new Set(["event_desk", "event_desk_test"]);

export function resettableDatabase(mysqlUrl: string): string {
  const name = decodeURIComponent(new URL(mysqlUrl).pathname.slice(1));
  if (!RESETTABLE_DATABASES.has(name)) {
    throw new ResetRefusedError(
      `Refusing to reset "${name}": only event_desk and event_desk_test can be reset.`,
    );
  }
  return name;
}

/** Both stores are reached before anything is dropped or deleted, so this always means "nothing was changed". */
const unreachable = (store: string, error: unknown): ResetRefusedError =>
  new ResetRefusedError(
    `Refusing to reset: cannot reach ${store} (${error instanceof Error ? error.message : "unknown error"}). Nothing was changed.`,
  );

export const API_PROBE_TIMEOUT_MS = 3_000;

/** "answered": got a response of any status. "stopped": the connection was refused. "inconclusive": anything else. */
export type ApiProbe = "answered" | "stopped" | "inconclusive";

/**
 * True only if every connection attempt was refused. Node reports the code in different places:
 * on the error, on its `cause`, or (for `localhost`, which resolves to ::1 and 127.0.0.1) on each
 * error of an AggregateError, so all three are followed.
 */
export function isConnectionRefused(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors.every(isConnectionRefused);
  }
  if ("code" in error && error.code === "ECONNREFUSED") return true;
  return "cause" in error && isConnectionRefused(error.cause);
}

/**
 * Fails closed. Only a refused connection proves the API is stopped; `/api/health` may take about
 * 1.5 s when a store is down, so a timeout, a reset or any other error is inconclusive, not "stopped".
 */
export async function probeApi(url: string, timeoutMs = API_PROBE_TIMEOUT_MS): Promise<ApiProbe> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel();
    return "answered";
  } catch (error) {
    return isConnectionRefused(error) ? "stopped" : "inconclusive";
  }
}

export async function apiAnswers(url: string, timeoutMs = API_PROBE_TIMEOUT_MS): Promise<boolean> {
  return (await probeApi(url, timeoutMs)) !== "stopped";
}

export interface ResetOptions {
  mysqlUrl: string;
  redisUrl: string;
  healthUrl: string;
  isApiRunning?: (healthUrl: string) => Promise<boolean>;
}

export interface ResetReport {
  database: string;
  deletedKeys: Record<string, number>;
}

/**
 * F1 explicit reset: drop and recreate the application database (attendance, briefings, previews,
 * generation snapshots and added notes), then delete only this application's Redis keys.
 * The next start migrates and reseeds E101.
 */
export async function resetStore(options: ResetOptions): Promise<ResetReport> {
  const database = resettableDatabase(options.mysqlUrl);
  const probe: ApiProbe = options.isApiRunning
    ? (await options.isApiRunning(options.healthUrl))
      ? "answered"
      : "stopped"
    : await probeApi(options.healthUrl);
  if (probe === "answered") {
    throw new ResetRefusedError(
      `Refusing to reset while the event API answers at ${options.healthUrl}. Stop the event API (and the AI Gateway) first.`,
    );
  }
  if (probe === "inconclusive") {
    throw new ResetRefusedError(
      `Refusing to reset: could not confirm the event API is stopped (no answer or an unexpected error from ${options.healthUrl}). Stop the event API (and the AI Gateway) and retry.`,
    );
  }

  // Connect to Redis first: if it is unreachable, nothing has been changed yet.
  const redis = new Redis(options.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    retryStrategy: () => null,
  });
  redis.on("error", () => undefined); // connect() and commands report failures through their promises
  try {
    try {
      await redis.connect();
    } catch (error) {
      throw unreachable("Redis", error);
    }

    const server = new URL(options.mysqlUrl);
    server.pathname = "/";
    let connection: Connection;
    try {
      connection = await createConnection(server.toString());
    } catch (error) {
      throw unreachable("MySQL", error);
    }
    try {
      try {
        await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
        await connection.query(
          `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
        );
      } finally {
        await connection.end();
      }

      const deletedKeys: Record<string, number> = {};
      for (const prefix of APPLICATION_KEY_PREFIXES) {
        deletedKeys[prefix] = await deleteKeysByPrefix(redis, prefix);
      }
      return { database, deletedKeys };
    } catch (error) {
      throw new ResetIncompleteError(database, error);
    }
  } finally {
    redis.disconnect();
  }
}
