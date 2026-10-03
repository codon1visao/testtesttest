# Spike: BullMQ fixed windows (T5 §6)

Date: 2026-10-03 · BullMQ 6.3.11 · ioredis 5.11.1 · Redis 8.10.2 · Node 24.14.0

All four checks PASS. Final results come from run 3 (run 2 is identical in outcome; run 1 failed S-4 because of a
flaw in the check, explained below).

| Check                                                                     | Result | Observed                                                                         |
| ------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| S-1 Throttle de-duplication gives one job per fixed window               | PASS   | First job ran at 1600 ms (window 1500 ms); next window ran at 3151 ms            |
| S-2 Delayed job and dedup key survive a Redis restart                    | PASS   | Restart finished at 577 ms; job ran at 6016 ms (window 6000 ms)                  |
| S-3 Custom backoff reads `retryAfterMs`; `UnrecoverableError` is terminal | PASS   | Retry gap 1274 ms for `retryAfterMs` 1200; unrecoverable job attempts 1          |
| S-4 Stalled job re-runs with updated `data.dispatch`                     | PASS   | Re-run saw `dispatch="sending"`, `stalledCounter=1`                              |

Across runs 2 and 3 the timings were stable: S-1 first job 1609 / 1600 ms, S-3 gap 1286 / 1274 ms, S-2 ran at
6051 / 6016 ms.

## Consequences for Plan 5

- S-1 PASS: `deduplication: { id, ttl }` plus `delay` gives a fixed window as written in T5 §3. Adds inside the window
  return the existing job and do not extend the cutoff; an add after the cutoff opens a new window.
- S-2 PASS: the delayed job and its de-duplication key survive a Redis restart (AOF, `appendfsync always`), and an add
  after the restart joins the still-open window. S-2 used a graceful restart, so it shows survival across a restart
  only. The `feedback_pending_since` reconciler is still required by F7 Durability and F7-10 (crash after the note
  commit, before scheduling), so Plan 5 must keep it.
- S-3 PASS: `settings.backoffStrategy` receives the thrown error, so a `RetryAfterError.retryAfterMs` can drive the
  delay; `UnrecoverableError` fails the job after one attempt. The fallback (`job.moveToDelayed` + `DelayedError`) is
  not needed.
- S-4 PASS: a job whose worker is killed mid-call is re-run after stall detection and sees the data persisted with
  `job.updateData` before the crash (`dispatch: "sending"`), with `stalledCounter` 1. The MySQL dispatch-marker
  fallback is not needed for this mechanism. The Plan 5 batch handler must treat `dispatch: "sending"` as "the
  previous attempt may have reached the provider" and decide idempotently.
- Operational finding from S-4 (not a FAIL, but Plan 5 should know): stall detection is gated by a single
  `stalled-check` key per queue whose TTL is the `stalledInterval` of whichever worker last ran the check. A crashed
  worker started with the default `stalledInterval` (30 s) therefore delays recovery by the remainder of that TTL even
  when the recovering worker uses a shorter interval. In production, expect recovery within roughly
  `stalledInterval` + `lockDuration` after a crash, and configure every worker of the queue with the same
  `stalledInterval`.

## Changes made while running the spike

- Run 1 FAILED S-4 (`Timed out after 15000 ms waiting for the stalled job to re-run`). Diagnosis (job stayed `active`,
  its lock key had expired, `stalled-check` key had a TTL of about 29 s): the check itself was wrong, not BullMQ. The
  crash worker was created with the default `stalledInterval` (30 s), so it set the shared `stalled-check` key with a
  30 s TTL before dying, and the recovering worker (`stalledInterval: 1000`) could not run its stalled check until
  that key expired, which is after the check's 15 s timeout. Fix: the crash worker in `s4CrashChild` now also passes
  `stalledInterval: 1000`, matching the recovering worker. No assertion, timeout or expected value was changed. The
  behaviour under test (stalled job re-runs and sees `dispatch: "sending"`) is unchanged and passed in runs 2 and 3.
- ESLint (`no-confusing-void-expression`) flagged two arrow shorthands that return a void expression; braces were
  added around `worker.on("error", ...)` and the `child.on("exit", ...)` callbacks. Behaviour is identical.
- Installing `bullmq` pulls in the optional native accelerator `msgpackr-extract`, whose build script pnpm 11 refuses
  by default and reports as `ERR_PNPM_IGNORED_BUILDS` with exit code 1 (which would fail `pnpm install
  --frozen-lockfile` in CI). `pnpm-workspace.yaml` now records `allowBuilds: msgpackr-extract: false`, which only skips the
  optional package's install/build script. The prebuilt platform binary
  (`@msgpackr-extract/msgpackr-extract-<platform>`) still loads where available, and `msgpackr` falls back to pure JS
  otherwise. The spike ran without the build step.
- No BullMQ 6 option was renamed; the brief's code type-checked unchanged apart from the restatements above.

## Raw output

Run 1 (before the S-4 check fix; the S-2 restart still ran):

```text
$ tsx src/run-spike.ts
PASS S-1 throttle de-duplication gives one job per fixed window — first job ran at 1579 ms (window 1500 ms); next window ran at 3200 ms
PASS S-3 custom backoff reads retryAfterMs; UnrecoverableError is terminal — retry gap 1295 ms for retryAfterMs 1200; unrecoverable job attempts 1
FAIL S-4 a stalled job re-runs with its updated data.dispatch — Timed out after 15000 ms waiting for the stalled job to re-run
 Container event-desk-redis-1 Restarting
 Container event-desk-redis-1 Started
PASS S-2 delayed job and de-duplication key survive a Redis restart — restart finished at 520 ms; job ran at 6073 ms (window 6000 ms)
Exit status 1
```

Run 2 (after the fix):

```text
$ tsx src/run-spike.ts
PASS S-1 throttle de-duplication gives one job per fixed window — first job ran at 1609 ms (window 1500 ms); next window ran at 3164 ms
PASS S-3 custom backoff reads retryAfterMs; UnrecoverableError is terminal — retry gap 1286 ms for retryAfterMs 1200; unrecoverable job attempts 1
PASS S-4 a stalled job re-runs with its updated data.dispatch — re-run saw dispatch="sending", stalledCounter=1
 Container event-desk-redis-1 Restarting
 Container event-desk-redis-1 Started
PASS S-2 delayed job and de-duplication key survive a Redis restart — restart finished at 466 ms; job ran at 6051 ms (window 6000 ms)
```

Run 3 (after the fix):

```text
$ tsx src/run-spike.ts
PASS S-1 throttle de-duplication gives one job per fixed window — first job ran at 1600 ms (window 1500 ms); next window ran at 3151 ms
PASS S-3 custom backoff reads retryAfterMs; UnrecoverableError is terminal — retry gap 1274 ms for retryAfterMs 1200; unrecoverable job attempts 1
PASS S-4 a stalled job re-runs with its updated data.dispatch — re-run saw dispatch="sending", stalledCounter=1
 Container event-desk-redis-1 Restarting
 Container event-desk-redis-1 Started
PASS S-2 delayed job and de-duplication key survive a Redis restart — restart finished at 577 ms; job ran at 6016 ms (window 6000 ms)
```
