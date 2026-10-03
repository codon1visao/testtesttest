import { type EventId, type RunId, SUPPLIED_EVENT } from "@event-desk/contracts";
import type { Redis } from "ioredis";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchJobContext, BatchJobHandler, BatchStep } from "../ports/briefing-batch-queue.js";
import { startFreezableTcpProxy } from "../testing/freezable-tcp-proxy.js";
import { clearApplicationKeys, openTestRedis } from "../testing/redis.js";
import { silentLogger, testRedisUrl } from "../testing/test-config.js";
import { BullMqBriefingBatchQueue } from "./bullmq-briefing-batch-queue.js";
import { uuidV7IdGenerator } from "./uuid-v7-id-generator.js";

const E101 = SUPPLIED_EVENT.id;
const WINDOW_MS = 400;
let redis: Redis;
let queue: BullMqBriefingBatchQueue;

interface Seen {
  runId: RunId;
  attempt: number;
  at: number;
  interrupted: boolean;
}

function handler(step: (job: BatchJobContext, seen: Seen[]) => Promise<BatchStep>) {
  const seen: Seen[] = [];
  const stateChanged = vi.fn((_eventId: EventId) => Promise.resolve());
  const abandoned = vi.fn((_job: { runId: RunId; eventId: EventId }) => Promise.resolve());
  const value: BatchJobHandler = {
    handle: (job) => {
      seen.push({
        runId: job.runId,
        attempt: job.attempt,
        at: Date.now(),
        interrupted: job.interruptedWhileSending,
      });
      return step(job, seen);
    },
    abandoned,
    stateChanged,
  };
  return { value, seen, stateChanged, abandoned };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("timed out");
    await sleep(20);
  }
}

beforeAll(async () => {
  redis = await openTestRedis();
});
afterAll(async () => {
  await clearApplicationKeys(redis);
  redis.disconnect();
});
beforeEach(async () => {
  await clearApplicationKeys(redis);
  queue = new BullMqBriefingBatchQueue({
    redisUrl: testRedisUrl(),
    windowMs: WINDOW_MS,
    maxAttempts: 3,
    ids: uuidV7IdGenerator,
    clock: { now: () => new Date() },
    logger: silentLogger,
    lockDurationMs: 2_000,
    stalledIntervalMs: 1_000,
    unexpectedRetryDelayMs: 100,
  });
});
afterEach(async () => {
  await queue.close();
});

describe("BullMqBriefingBatchQueue (T5 §3, spike S-1/S-3/S-4)", () => {
  it("S-1 / F7-01 / F7-02: schedules inside a window join one job whose cutoff never moves", async () => {
    const h = handler(() => Promise.resolve({ kind: "done" }));
    const t0 = Date.now();
    await queue.schedule(E101);
    await sleep(150);
    await queue.schedule(E101);
    await sleep(150);
    await queue.schedule(E101);
    const collecting = await queue.status(E101);
    expect(collecting).toMatchObject({ state: "collecting", maxAttempts: 3 });
    expect(collecting?.closesAt?.getTime()).toBe((collecting?.openedAt.getTime() ?? 0) + WINDOW_MS);
    queue.start(h.value);
    await waitFor(() => h.seen.length === 1);
    expect((h.seen[0]?.at ?? 0) - t0).toBeGreaterThanOrEqual(WINDOW_MS - 50);
    expect((h.seen[0]?.at ?? 0) - t0).toBeLessThan(WINDOW_MS + 600);

    await queue.schedule(E101); // F7-03: after the cutoff, a new window
    await waitFor(() => h.seen.length === 2);
    expect(h.seen[1]?.runId).not.toBe(h.seen[0]?.runId);
    await waitFor(async () => (await queue.status(E101)) === null);
    expect(h.stateChanged).toHaveBeenCalled();
  });

  it("S-3: a retry step waits the handler's delay and shows retry_wait", async () => {
    const h = handler((job) =>
      Promise.resolve(job.attempt === 1 ? { kind: "retry", delayMs: 600 } : { kind: "done" }),
    );
    queue.start(h.value);
    await queue.schedule(E101);
    await waitFor(() => h.seen.length === 1);
    await waitFor(async () => (await queue.status(E101))?.state === "retry_wait");
    expect(await queue.status(E101)).toMatchObject({ state: "retry_wait", attempt: 2 });
    await waitFor(() => h.seen.length === 2);
    expect(h.seen.map((s) => s.attempt)).toEqual([1, 2]);
    expect((h.seen[1]?.at ?? 0) - (h.seen[0]?.at ?? 0)).toBeGreaterThanOrEqual(550);
  });

  it("S-4: an execution that stopped after markSending is seen as interrupted by the next one", async () => {
    const h = handler(async (job) => {
      if (job.attempt === 1) {
        await job.markSending();
        throw new Error("crashed mid-call");
      }
      return { kind: "done" };
    });
    queue.start(h.value);
    await queue.schedule(E101);
    await waitFor(() => h.seen.length === 2);
    expect(h.seen.map((s) => s.interrupted)).toEqual([false, true]);
  });

  it("markSettled clears the marker, so a known failure's retry is not 'interrupted'", async () => {
    const h = handler(async (job) => {
      if (job.attempt === 1) {
        await job.markSending();
        await job.markSettled();
        return { kind: "retry", delayMs: 50 };
      }
      return { kind: "done" };
    });
    queue.start(h.value);
    await queue.schedule(E101);
    await waitFor(() => h.seen.length === 2);
    expect(h.seen[1]?.interrupted).toBe(false);
  });

  it("calls abandoned after unexpected errors on every attempt", async () => {
    const h = handler(() => Promise.reject(new Error("bug")));
    queue.start(h.value);
    await queue.schedule(E101);
    await waitFor(() => h.abandoned.mock.calls.length === 1, 8_000);
    expect(h.seen).toHaveLength(3);
    expect(h.abandoned).toHaveBeenCalledWith({ runId: h.seen[0]?.runId, eventId: E101 });
  });

  it("F7 rule 5: a running job sees a newer ready job", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let newer: boolean | null = null;
    const h = handler(async (job, seen) => {
      if (seen.length === 1) {
        await gate;
        newer = await job.hasNewerReadyJob();
      }
      return { kind: "done" };
    });
    queue.start(h.value);
    await queue.schedule(E101);
    await waitFor(() => h.seen.length === 1);
    await queue.schedule(E101); // the first window's dedup key expired at its cutoff: a new window
    await sleep(WINDOW_MS + 100); // ...whose job is now ready but waiting for the worker
    expect(await queue.status(E101)).toMatchObject({ state: "generating" });
    release();
    await waitFor(() => newer !== null);
    expect(newer).toBe(true);
  });

  it("schedule rejects quickly when Redis is unreachable", async () => {
    const offline = new BullMqBriefingBatchQueue({
      redisUrl: "redis://127.0.0.1:1/1",
      windowMs: WINDOW_MS,
      maxAttempts: 3,
      ids: uuidV7IdGenerator,
      clock: { now: () => new Date() },
      logger: silentLogger,
    });
    const started = Date.now();
    await expect(offline.schedule(E101)).rejects.toBeInstanceOf(Error);
    expect(Date.now() - started).toBeLessThan(5_000);
    const statusStarted = Date.now();
    await expect(offline.status(E101)).rejects.toBeInstanceOf(Error);
    expect(Date.now() - statusStarted).toBeLessThan(5_000);
    await offline.close();
  });

  it("schedule and status reject quickly when Redis goes away after connecting", async () => {
    const redisAddress = new URL(testRedisUrl());
    const proxy = await startFreezableTcpProxy({
      host: redisAddress.hostname,
      port: Number(redisAddress.port || "6379"),
    });
    const flaky = new BullMqBriefingBatchQueue({
      redisUrl: `redis://${proxy.address}${redisAddress.pathname}`,
      windowMs: WINDOW_MS,
      maxAttempts: 3,
      ids: uuidV7IdGenerator,
      clock: { now: () => new Date() },
      logger: silentLogger,
    });
    try {
      await flaky.schedule(E101);
      expect(await flaky.status(E101)).toMatchObject({ state: "collecting" });
      await proxy.close();
      const started = Date.now();
      await expect(flaky.schedule(E101)).rejects.toBeInstanceOf(Error);
      await expect(flaky.status(E101)).rejects.toBeInstanceOf(Error);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await flaky.close();
      await proxy.close();
    }
  });
});
