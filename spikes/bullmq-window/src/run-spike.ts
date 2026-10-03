// T5 §6 spike: verifies the BullMQ behaviours the batch design depends on.
// Run: pnpm infra:up && pnpm --filter @event-desk/spike-bullmq-window spike
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { type Job, Queue, UnrecoverableError, Worker } from "bullmq";

const REDIS_URL = new URL(process.env.SPIKE_REDIS_URL ?? "redis://127.0.0.1:6379/15");
const connection = {
  host: REDIS_URL.hostname,
  port: Number(REDIS_URL.port || 6379),
  db: Number(REDIS_URL.pathname.slice(1) || 15),
  maxRetriesPerRequest: null,
};
const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEDUP_ID = "briefing-batch:E101";

interface BatchData {
  eventId: string;
  dispatch?: "pending" | "sending";
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Check failed: ${message}`);
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline)
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(25);
  }
}

const sleepUntil = (at: number) => sleep(Math.max(0, at - Date.now()));
const uniqueQueueName = (label: string) => `spike-${label}-${Date.now()}`;

async function totalJobs(queue: Queue): Promise<number> {
  const counts = await queue.getJobCounts("delayed", "waiting", "active", "completed", "failed");
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/** The production call shape from T5 §3: throttle de-duplication + delay = window. */
function addBatch(queue: Queue<BatchData>, windowMs: number): Promise<Job<BatchData>> {
  return queue.add(
    "briefing.batch",
    { eventId: "E101" },
    { deduplication: { id: DEDUP_ID, ttl: windowMs }, delay: windowMs },
  );
}

async function cleanUp(queue: Queue, ...workers: Worker[]): Promise<void> {
  await Promise.all(workers.map((worker) => worker.close()));
  await queue.obliterate({ force: true });
  await queue.close();
}

// S-1: one job per fixed window; adds inside the window are ignored without extending the cutoff;
// an add at or after the cutoff opens a new window.
async function s1FixedWindow(): Promise<string> {
  const windowMs = 1500;
  const name = uniqueQueueName("s1");
  const queue = new Queue<BatchData>(name, { connection });
  const ran: number[] = [];
  const worker = new Worker<BatchData>(
    name,
    async () => {
      ran.push(Date.now());
    },
    { connection, concurrency: 1 },
  );
  try {
    const t0 = Date.now();
    const first = await addBatch(queue, windowMs);
    for (const offset of [200, 700, windowMs - 200]) {
      await sleepUntil(t0 + offset);
      await addBatch(queue, windowMs);
    }
    check((await totalJobs(queue)) === 1, "adds inside the window create no new job");
    check(
      (await queue.getDeduplicationJobId(DEDUP_ID)) === first.id,
      "dedup key holds the window's job",
    );

    await waitFor(() => ran.length === 1, windowMs + 3000, "the window's job to run");
    const ranAt = (ran[0] ?? Number.NaN) - t0;
    check(ranAt >= windowMs - 50, `job ran at the cutoff, not before (ran at ${ranAt} ms)`);
    check(ranAt < windowMs + 800, `cutoff was not extended by the late add (ran at ${ranAt} ms)`);

    await sleepUntil(t0 + windowMs + 100);
    await addBatch(queue, windowMs);
    await waitFor(() => ran.length === 2, windowMs + 3000, "the next window's job to run");
    check((await totalJobs(queue)) === 2, "an add after the cutoff opened a new window");
    return `first job ran at ${ranAt} ms (window ${windowMs} ms); next window ran at ${(ran[1] ?? 0) - t0} ms`;
  } finally {
    await cleanUp(queue, worker);
  }
}

// S-3: a custom backoff strategy reads the thrown error's retryAfterMs; UnrecoverableError stops retries.
class RetryAfterError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("temporary provider error");
    this.name = "RetryAfterError";
    this.retryAfterMs = retryAfterMs;
  }
}

function providerAwareBackoff(attemptsMade: number, type?: string, err?: Error): number {
  const exponential = 100 * 2 ** attemptsMade;
  if (type !== "provider-aware") return exponential;
  return err instanceof RetryAfterError ? Math.max(exponential, err.retryAfterMs) : exponential;
}

async function s3BackoffReadsRetryAfter(): Promise<string> {
  const retryAfterMs = 1200;
  const name = uniqueQueueName("s3");
  const queue = new Queue(name, { connection });
  const startedAt = new Map<string, number[]>();
  const worker = new Worker(
    name,
    async (job) => {
      startedAt.set(job.name, [...(startedAt.get(job.name) ?? []), Date.now()]);
      if (job.name === "temporary" && job.attemptsMade === 0)
        throw new RetryAfterError(retryAfterMs);
      if (job.name === "terminal") throw new UnrecoverableError("PROVIDER_REFUSED");
    },
    { connection, settings: { backoffStrategy: providerAwareBackoff } },
  );
  try {
    const opts = { attempts: 3, backoff: { type: "provider-aware" } };
    await queue.add("temporary", {}, opts);
    await waitFor(() => (startedAt.get("temporary")?.length ?? 0) === 2, 8000, "the retry");
    const [firstTry = 0, secondTry = 0] = startedAt.get("temporary") ?? [];
    const gap = secondTry - firstTry;
    check(gap >= retryAfterMs - 50, `retry waited for retryAfterMs (gap ${gap} ms)`);

    const terminal = await queue.add("terminal", {}, opts);
    const terminalId = terminal.id ?? "";
    await waitFor(
      async () => (await queue.getJobState(terminalId)) === "failed",
      5000,
      "terminal failure",
    );
    const failed = await queue.getJob(terminalId);
    check(
      failed?.attemptsMade === 1,
      `UnrecoverableError stopped retries (attempts ${failed?.attemptsMade})`,
    );
    return `retry gap ${gap} ms for retryAfterMs ${retryAfterMs}; unrecoverable job attempts ${failed.attemptsMade}`;
  } finally {
    await cleanUp(queue, worker);
  }
}

// S-4: a job whose worker dies mid-call re-runs after stall detection and sees its updated data.
async function s4CrashChild(queueName: string): Promise<void> {
  const worker = new Worker<BatchData>(
    queueName,
    async (job) => {
      await job.updateData({ ...job.data, dispatch: "sending" });
      process.kill(process.pid, "SIGKILL"); // simulate a crash after the dispatch marker is persisted
    },
    // stalledInterval matches the recovering worker: the crashed worker's stalled-check key (TTL =
    // stalledInterval, default 30 s) is shared across workers and would otherwise delay recovery.
    { connection, lockDuration: 2000, stalledInterval: 1000 },
  );
  worker.on("error", (error) => {
    console.error("crash worker error", error);
  });
  await new Promise<never>(() => undefined); // wait to be killed
}

async function s4StalledRerun(): Promise<string> {
  const name = uniqueQueueName("s4");
  const queue = new Queue<BatchData>(name, { connection });
  await queue.add("briefing.batch", { eventId: "E101", dispatch: "pending" }, { attempts: 1 });

  const child = spawn(process.execPath, [...process.execArgv, SELF, "s4-crash", name], {
    stdio: "inherit",
  });
  const signal = await new Promise<NodeJS.Signals | null>((resolve) => {
    child.on("exit", (_code, sig) => {
      resolve(sig);
    });
  });
  check(signal === "SIGKILL", `the crash worker died mid-job (signal ${String(signal)})`);

  const seen: { dispatch: string | undefined; stalledCounter: number }[] = [];
  const worker = new Worker<BatchData>(
    name,
    async (job) => {
      seen.push({ dispatch: job.data.dispatch, stalledCounter: job.stalledCounter });
    },
    { connection, stalledInterval: 1000, maxStalledCount: 1, lockDuration: 2000 },
  );
  try {
    await waitFor(() => seen.length === 1, 15000, "the stalled job to re-run");
    const rerun = seen[0];
    check(
      rerun?.dispatch === "sending",
      `re-run saw the dispatch marker (got ${String(rerun?.dispatch)})`,
    );
    return `re-run saw dispatch="sending", stalledCounter=${rerun.stalledCounter}`;
  } finally {
    await cleanUp(queue, worker);
  }
}

// S-2: the delayed job and its de-duplication key survive a Redis restart (AOF, appendfsync always).
function restartRedis(): void {
  const restart = spawnSync("docker", ["compose", "restart", "redis"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  check(restart.status === 0, "docker compose restart redis succeeded");
}

async function s2SurvivesRestart(): Promise<string> {
  const windowMs = 6000;
  const name = uniqueQueueName("s2");
  let queue = new Queue<BatchData>(name, { connection });
  const t0 = Date.now();
  const first = await addBatch(queue, windowMs);
  const firstId = first.id ?? "";
  await queue.close();

  restartRedis();
  const restartedAt = Date.now() - t0;

  queue = new Queue<BatchData>(name, { connection });
  await queue.waitUntilReady();
  check(
    (await queue.getDeduplicationJobId(DEDUP_ID)) === firstId,
    "dedup key survived the restart",
  );
  check((await queue.getJobState(firstId)) === "delayed", "the window's job is still delayed");
  await addBatch(queue, windowMs);
  check((await totalJobs(queue)) === 1, "an add after the restart joined the open window");

  const ran: number[] = [];
  const worker = new Worker<BatchData>(
    name,
    async () => {
      ran.push(Date.now());
    },
    { connection },
  );
  try {
    await waitFor(() => ran.length === 1, windowMs + 8000, "the window's job after restart");
    const ranAt = (ran[0] ?? Number.NaN) - t0;
    check(ranAt >= windowMs - 50, `original cutoff kept (ran at ${ranAt} ms)`);
    check(
      ranAt < Math.max(windowMs, restartedAt) + 3000,
      `ran promptly at the cutoff (ran at ${ranAt} ms)`,
    );
    return `restart finished at ${restartedAt} ms; job ran at ${ranAt} ms (window ${windowMs} ms)`;
  } finally {
    await cleanUp(queue, worker);
  }
}

const CHECKS = [
  ["S-1", "throttle de-duplication gives one job per fixed window", s1FixedWindow],
  [
    "S-3",
    "custom backoff reads retryAfterMs; UnrecoverableError is terminal",
    s3BackoffReadsRetryAfter,
  ],
  ["S-4", "a stalled job re-runs with its updated data.dispatch", s4StalledRerun],
  ["S-2", "delayed job and de-duplication key survive a Redis restart", s2SurvivesRestart],
] as const;

async function main(): Promise<void> {
  const [mode, queueName] = process.argv.slice(2);
  if (mode === "s4-crash" && queueName) return s4CrashChild(queueName);

  let failures = 0;
  for (const [id, description, run] of CHECKS) {
    try {
      console.log(`PASS ${id} ${description} — ${await run()}`);
    } catch (error) {
      failures += 1;
      console.log(
        `FAIL ${id} ${description} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
