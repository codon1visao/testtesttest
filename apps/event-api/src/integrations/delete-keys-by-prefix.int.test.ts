import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearApplicationKeys, openTestRedis } from "../testing/redis.js";
import { deleteKeysByPrefix } from "./delete-keys-by-prefix.js";

let redis: Redis;

beforeAll(async () => {
  redis = await openTestRedis();
  await clearApplicationKeys(redis);
});
afterAll(async () => {
  await redis.del("other:keep");
  redis.disconnect();
});

describe("deleteKeysByPrefix", () => {
  it("deletes only keys under the prefix", async () => {
    await redis.set("event-desk:a", "1");
    await redis.set("event-desk:b:c", "1");
    await redis.set("bull:briefing-batch:1", "1");
    await redis.set("other:keep", "1");
    expect(await deleteKeysByPrefix(redis, "event-desk:")).toBe(2);
    expect(await redis.exists("other:keep", "bull:briefing-batch:1")).toBe(2);
    await deleteKeysByPrefix(redis, "bull:briefing-batch:");
  });

  it.each(["", "event-desk", "event-desk:*", "*:"])(
    "refuses the unsafe prefix %j",
    async (prefix) => {
      await expect(deleteKeysByPrefix(redis, prefix)).rejects.toThrow(/prefix/);
    },
  );
});
