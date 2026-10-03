import { Redis } from "ioredis";
import { createConnection } from "mysql2/promise";
import { deleteKeysByPrefix } from "../integrations/delete-keys-by-prefix.js";
import { APPLICATION_KEY_PREFIXES } from "../integrations/redis-keys.js";

/** Reset refuses rather than guesses: a running API, or a database it does not own. */
export class ResetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResetRefusedError";
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

export async function apiAnswers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return true;
  } catch {
    return false;
  }
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
  if (await (options.isApiRunning ?? apiAnswers)(options.healthUrl)) {
    throw new ResetRefusedError(
      `Refusing to reset while the event API answers at ${options.healthUrl}. Stop the event API (and the AI Gateway) first.`,
    );
  }

  const server = new URL(options.mysqlUrl);
  server.pathname = "/";
  const connection = await createConnection(server.toString());
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await connection.end();
  }

  const redis = new Redis(options.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  });
  await redis.connect();
  try {
    const deletedKeys: Record<string, number> = {};
    for (const prefix of APPLICATION_KEY_PREFIXES) {
      deletedKeys[prefix] = await deleteKeysByPrefix(redis, prefix);
    }
    return { database, deletedKeys };
  } finally {
    redis.disconnect();
  }
}
