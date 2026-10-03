import type { ConnectionOptions } from "bullmq";

function fromUrl(url: string) {
  const parsed = new URL(url);
  const db = Number(parsed.pathname.slice(1) || "0");
  return {
    host: parsed.hostname,
    port: Number(parsed.port || "6379"),
    db,
    ...(parsed.username === "" ? {} : { username: decodeURIComponent(parsed.username) }),
    ...(parsed.password === "" ? {} : { password: decodeURIComponent(parsed.password) }),
  };
}

/** Producer/status calls fail within ~2 s while Redis is down (the note is still saved: "deferred"). */
export const producerConnection = (url: string): ConnectionOptions => ({
  ...fromUrl(url),
  maxRetriesPerRequest: 1,
  connectTimeout: 1_000,
  retryStrategy: (attempt: number) => Math.min(attempt * 250, 2_000),
});

/** BullMQ workers need blocking commands that never give up (maxRetriesPerRequest: null). */
export const workerConnection = (url: string): ConnectionOptions => ({
  ...fromUrl(url),
  maxRetriesPerRequest: null,
  retryStrategy: (attempt: number) => Math.min(attempt * 250, 2_000),
});
