import type { Redis } from "ioredis";

const SAFE_PREFIX = /^[A-Za-z0-9_-]+(:[A-Za-z0-9_-]+)*:$/;

/** SCAN + DEL under one literal prefix (never FLUSHALL/FLUSHDB). Returns the number of keys deleted. */
export async function deleteKeysByPrefix(redis: Redis, prefix: string): Promise<number> {
  if (!SAFE_PREFIX.test(prefix)) {
    throw new Error(`Refusing to delete keys for the unsafe prefix "${prefix}".`);
  }
  let cursor = "0";
  let deleted = 0;
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
    cursor = next;
    if (keys.length > 0) deleted += await redis.del(...keys);
  } while (cursor !== "0");
  return deleted;
}
