import { once } from "node:events";
import type { Redis } from "ioredis";
import { deleteKeysByPrefix } from "../integrations/delete-keys-by-prefix.js";
import { createRedisClient } from "../integrations/redis-client.js";
import { APPLICATION_KEY_PREFIXES } from "../integrations/redis-keys.js";
import { silentLogger, testRedisUrl } from "./test-config.js";

export async function openTestRedis(): Promise<Redis> {
  const client = createRedisClient(testRedisUrl(), silentLogger);
  if (client.status !== "ready") await once(client, "ready");
  return client;
}

export async function clearApplicationKeys(redis: Redis): Promise<void> {
  for (const prefix of APPLICATION_KEY_PREFIXES) await deleteKeysByPrefix(redis, prefix);
}
