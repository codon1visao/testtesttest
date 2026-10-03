# Specification review — 2026-10-03

Scope: [project brief](../project-brief.md) and every file in [specs/](../specs/README.md) (README, F1–F8, S1, T1, T2). Proposed resolutions are collected in [T3 — Architecture and repository layout](../specs/12-architecture-and-repository.md).

Overall: the specs cover the brief completely. Every outcome, rule and supplied record traces to at least one acceptance criterion, and the evidence rules (theme ≥ 2 distinct sources, not-recorded ≠ absent, no invented consensus) are stated clearly. The problems below are mostly **contradictions between technology choices and behavioural rules**, plus **operational details that were never assigned an owner**.

## Resolution log (2026-10-03, after user feedback)

**Final status (2026-10-03): every specification is confirmed by the user; D1–D15 are closed.** Rows below record how each finding was resolved; "Proposed" wording reflects the state at the time and has since been confirmed.

| Finding | Outcome | Where |
| --- | --- | --- |
| C1 shared contract | **Confirmed:** one root pnpm workspace with `apps/web`, `apps/event-api`, `apps/ai-gateway`, `packages/contracts`, `packages/tcp-rpc` | T3 §2, README, T1, T2, F8 |
| C2 Redis cache | **Confirmed:** keep caching the single event read. Every write flushes it with a version bump + delete (prevents the stale-refill race). TTL is capped at the next time-driven state change, with a bypass flag if a flush fails. | T3 §7, T2, F1 |
| C3 queue | **Proposed:** BullMQ core primitives only. Windows are owned by the app; `priority = window sequence`; retries run inside the active job; shared cooldown key; MySQL records outcomes idempotently. Temporal is documented as the alternative. Spike pending. | T5, F7, D7 |
| M15 transactions | **Confirmed store:** MySQL 8.4 + TypeORM. **Proposed schema:** normalised tables with composite FKs that enforce snapshot-only citations and text-only saves; 8 transaction boundaries (TX1–TX8) with a per-event row lock | T4, F1, T2, D3 |
| C4 revision counters | **Confirmed:** adopted for write conflicts only | README, F1, F2 |
| C5 retry | **Confirmed (revised):** no retry endpoint; the Retry button sends a normal Generate request. Automatic in-job retries of transient errors are unchanged. | T5 §4, F7, F8, D13 |
| C6 conflict sources | **Proposed:** a conflict cites ≥ 2 different notes (one per opposing view) and is worded as a difference between anonymous notes, never between members or counted people; F4-15 added | T3 §4, F3, F4, D12 |
| C8 freshness | **Confirmed:** per-member snapshot comparison; a swap counts as a change; an exact revert is current again | T3 §6, T4, F6, D5 |
| A10 infrastructure | **Confirmed:** Docker Compose for MySQL and Redis only; apps run locally | T3 §13 |

| Generation model (follow-up discussion) | **Confirmed:** coordinator Generate is synchronous (API → Gateway → OpenAI), single-flight and has priority; new feedback is batched per fixed window (one generation reading all notes at run time); a test feedback form + script add notes; batch progress is visible in the UI | F4, F7, F3, T5, D6, D9 |
| C6 conflict sources (follow-up) | **Confirmed:** two different notes per conflict; the follow-up suggestion stays visible | D12 |
| C7 manual regenerate blocked by dirty text | **Resolved:** Generate no longer requires resolving briefing text; switching to the new preview does | F4, F6 |

| Follow-up decisions (2026-10-03) | **Confirmed:** BullMQ (D7), SSE live updates (D14), React Router (D10). **Recommended:** the T4 schema with composite FKs, `preview_slots`, binary-collated IDs, CHECK constraints and hand-written migrations (D15) | T4, T5, T1, T3 |

The remaining findings (C9–C11, M1–M26) are addressed in T3/T4 where noted, or are still open.

Severity: **High** blocks implementation or forces a rewrite later. **Medium** produces ambiguous behaviour that two developers would implement differently. **Low** is wording or naming.

---

## 1. Conflicts

### C1 · High · One shared contract, but two separate package roots

- README ("Reuse one contract… not code to copy into multiple DTOs"), F8 ("one shared contract module") and T1 ("reusable contracts/validation") all require the frontend and both backend services to use the same `BriefingContent`, `BriefingTextEdits`, error and attendance schemas.
- T2 places the pnpm monorepo *inside* `backend/`, and T1 places the frontend in a separate root `frontend/`. With that layout the frontend cannot depend on a backend workspace package cleanly. `link:../backend/...` would load two copies of Zod, so `instanceof` checks and type identity break, and versions drift apart.
- **Resolution:** put one pnpm workspace at the **repo root** that includes `frontend` and `backend/apps/*` and `backend/packages/*`. The physical directories stay exactly as T1/T2 describe; only `pnpm-workspace.yaml` moves up. (T3 §2) ⚠ This changes the wording of confirmed D11.

### C2 · High · Redis response caching has nothing it can safely cache

- T2: "volatile state must be read live unless a correct invalidation policy is established"; cached data "must not decide… freshness".
- The API has exactly **one** read, `GET /api/events/E101`. It returns attendance, freshness, job status and all three briefing slots, which is every volatile field in the system, and F7 polls it while work runs.
- Cache-aside with invalidation has a well-known race: a read loads the old document, a write commits and deletes the key, then the read stores the old copy. That race would show stale attendance or freshness, which is the exact thing the specs forbid. A versioned cache key would need a Mongo read to learn the version, so it saves nothing. With one coordinator and one document there is no load for a cache to absorb.
- **Resolution:** remove Redis caching from v1 and send `Cache-Control: no-store` on the event read. If Redis must stay, limit it to data that never changes during a run (event metadata and the feedback list) and accept that it brings no measurable benefit. (T3 §6) ⚠ Changes confirmed D11. **Needs your decision.**

### C3 · High · The BullMQ recommendation conflicts with F7's ordering and atomicity rules

- F7 says "An automatic retry stays with its current job at the head of the queue… Later winners wait." In BullMQ, a job that fails with backoff moves to the *delayed* set, and a concurrency-1 worker then picks up the next waiting job. Later winners overtake the retrying job.
- F4 step 6 and F7 step 5 require committing the result, the incoming slot and the job state **atomically**. With BullMQ, job state lives in Redis and slots live in MongoDB, so you would need an outbox or reconciliation that the specs never describe. F7 flags this ("explicitly reconcile the MongoDB-write/queue-enqueue boundary") but leaves it unsolved.
- BullMQ requires Redis `maxmemory-policy noeviction`. A response cache wants an evicting policy. Eviction policy is set per Redis instance, so the cache and the queue would need **two Redis instances**.
- The fixed window, stable job ID, latest-wins rule and shared persisted cooldown would all be custom code on top of BullMQ anyway.
- **Resolution:** keep the queue state in MongoDB, inside the same document as the slots. Every transition then becomes one atomic conditional update, and Redis is no longer needed at all (T3 §7). This settles the open D7.

### C4 · High · Revision counters are labelled "optional" while the API and tests depend on them

- The README, F2 and F6 repeatedly call `attendanceRevision`/`briefingRevision` an "optional internal proposal". But `PUT /attendance` requires `baseAttendanceRevision`, `PUT /briefing` requires `baseBriefingRevision` (first save = `0`), and F2's `409 ATTENDANCE_CONFLICT`, F5-06 and F6-11 can only be implemented with *some* concurrency token.
- **Resolution:** adopt both counters as internal optimistic-concurrency tokens. They are not history, and the hedging should be removed so the API contract is definite. Use them **only** for write conflicts, not for freshness (see C8).

### C5 · High · "Retry" means two different things, and it has no endpoint

- F7 (durability): an unknown outcome "requires coordinator Retry **for that job**". F7 ("Failures") and F8 say the opposite: a coordinator retry "enters the collection-window path **from current saved inputs, with fresh job/attempt identity**".
- No Retry endpoint appears in the README API table or in F7's API table.
- **Resolution:** a coordinator Retry is a new `POST /briefing-preview` with `trigger: "retry"` and a `retryOfJobId` used only for display. It creates a new job from current saved inputs, joins the normal window and respects the cooldown. The failed job keeps its terminal state. Reword the F7 durability bullet to match.

### C6 · Medium · The minimum number of sources for a conflict disagrees between F3 and F4

- F3: "A conflict describing opposing positions needs notes supporting **both** positions."
- F4 rule 4 and README: "at least **one** for each conflict".
- One note cannot represent a disagreement *between* sources. F01's "enjoyable, but…" is a mixed view inside a single note, not a conflict.
- **Resolution:** require at least 2 distinct source IDs per conflict structurally. Both supplied conflicts (F01/F02 and F03/F04) satisfy this.

### C7 · Medium · Manual Regenerate is blocked by unsaved text, but background generation is not

- F6 and F4 require the coordinator to Save or Discard unsaved briefing text before a *manual* Regenerate. Yet F7 lets *automatic* generation run during editing, because results only ever land in the incoming slot and never touch the editor.
- Neither path can overwrite the editor, so the block protects nothing and adds friction. (Blocking on **unsaved attendance** still makes sense, because generation uses saved attendance and the coordinator would expect local changes to be included.)
- **Resolution:** allow manual Generate while briefing text is dirty. The Save/Discard/Cancel prompt is only needed at **Review new preview**, which F7 already specifies.

### C8 · Medium · D5 freshness: the "simpler" option is actually the more complex one

- F5 step 2 and F6 already require persisting the generation's attendance snapshot so the baseline counts can be shown. F2-07 (swap two members) requires that snapshot to be per member.
- Once that snapshot is stored, `stale = snapshot ≠ current saved statuses` is a single comparison. It needs no counter, handles swaps, and makes an exact revert current again, which matches the brief: the briefing describes the attendance that now exists.
- The proposed default ("stale forever after any change") instead requires recording a revision at generation time *and* keeping a separate rule for reverts.
- **Resolution:** decide D5 as **snapshot comparison** and update F6-06.

### C9 · Medium · A dangling reference is handled two different ways

- F1 rule 6: invalid or incomplete stored data → fail clearly and do not load.
- F3: a stored briefing with a missing source → show an "unavailable-source error" on that item, which implies the load succeeds.
- **Resolution:** startup and read validation are **structural** (Zod parse of the document). A mismatch between stored references and the feedback list is reported **per item** and blocks Save (F5-13). F1 should say this explicitly.

### C10 · Low · Slot names are inconsistent

The README data table and F7's API table call the selected slot `generatedPreview`, while the prose calls it "selected generated preview". Name the fields `selectedPreview` and `incomingPreview` so the API says what the slot means.

### C11 · Low · Status labels contradict each other

The README status says "not approved for implementation" while D1–D4 and D8–D11 say "Confirmed", and F7 says "No queue library… is approved". Add one line stating which decisions are approved for implementation and which are still pending (D5, D7 and the items in T3).

---

## 2. Missing or under-specified points

### Behaviour

| # | Gap | Proposed answer |
| --- | --- | --- |
| M1 | What selecting the incoming preview does to the incoming slot | Selection **moves** incoming → selected and sets incoming to `null`. The previous selected preview is discarded (no history). |
| M2 | Whether the first ever result is selected automatically (F6 table: "Generate an incoming candidate; select it for review") | Never auto-select. Only the coordinator moves slots. The UI shows a prominent **Review new preview** button. Keep the invariant simple. |
| M3 | No way to dismiss an unwanted selected or incoming preview | Optional `DELETE /briefing-preview/{selected\|incoming}` guarded by generation ID. It can also be dropped explicitly: previews are bounded, so leaving them is harmless. |
| M4 | An attendance save during an open window makes that window's winner stale before it runs | Accept this as specified, but show "will use attendance saved at HH:MM:SS" on the collecting status so the stale result does not surprise the coordinator. |
| M5 | Undefined "day" for the 20-attempts-per-day budget, and where it is persisted | UTC day, persisted in the queue state. Exhaustion → `429 DAILY_LIMIT_REACHED` for manual requests, and the job fails visibly with the same code. |
| M6 | Detecting an "unknown outcome" needs a persisted dispatch marker | Persist `dispatch: "sending"` **before** the first byte reaches the socket. On restart, `claimed` → safe to retry automatically; `sending` → `AI_OUTCOME_UNKNOWN`. |
| M7 | Nothing guarantees a single worker (a dev-server restart overlap or a second process would break windows and FIFO) | A worker lease (`ownerId` and `expiresAt`, renewed) stored in the queue state. Only the lease holder dispatches. |
| M8 | S1 says "restrict reference IDs to the job's feedback IDs where supported" but also "use the shared Zod schema", and the two cannot both be static | A shared **schema factory** `buildGeneratedSectionsSchema(feedbackIds)` that builds a `z.enum(ids)` for each request. The Gateway creates the agent per request. |
| M9 | Shape of generation status and provenance in the `GET` response is never defined | Defined in T3 §5 (`GenerationStatusView`, `GenerationProvenance`). |
| M10 | Polling interval, and how "toast once per outcome" survives a page refresh | Poll every 1 s while collecting/queued/running/retry-wait. Remember announced `jobId`s in `sessionStorage`. |
| M11 | Where the line between `400` and `422` falls (e.g. blank item text) | `400 VALIDATION_FAILED` = request fails the Zod schema (shape, types, unknown fields, blank or too-long text). `422` = valid shape that conflicts with server state (wrong item count for that generation, invalid retained reference). |
| M12 | No consolidated error-code catalogue (codes are scattered across five files) | One `ErrorCode` enum in `@event-desk/contracts`. List in T3 §5. |
| M13 | How the frontend knows which event to open | A constant `E101` in frontend config and no router. The brief needs only one page. |

### Engineering and operations

| # | Gap | Proposed answer |
| --- | --- | --- |
| M14 | The README and T1/T2 cite "repository working agreements", but no such file exists (the repo holds only `docs/`) | Add a root `AGENTS.md`/`CLAUDE.md` with the dependency-approval rule, naming and layering rules, and commands. |
| M15 | MongoDB multi-document transactions **require a replica set**, F1 allows transactions, and the local Mongo topology is never specified | Avoid transactions entirely: one aggregate document per event (T3 §6). This works on a standalone `mongod` and on `mongodb-memory-server`. |
| M16 | Write durability: an acknowledged save must survive a restart | Write concern `{ w: 1, j: true }` (journaled). Mongo data in a named Docker volume. |
| M17 | No test tooling or strategy, even though every spec ends in acceptance criteria | Vitest, Supertest, mongodb-memory-server, a fake Gateway TCP server, MSW and Playwright, plus a manual live-model smoke script (T3 §10). |
| M18 | No local runtime spec: Docker Compose, ports, env vars, process start order | T3 §11. |
| M19 | Node/TypeScript versions, dev runner and build tooling are left open | Node 24 LTS, TypeScript strict, `tsx` for development, `tsc -b` for builds. |
| M20 | Logging library and secret redaction are not chosen (S1 lists what must not be logged) | `pino` with `redact` paths in both services (requires dependency approval). |
| M21 | No readiness check, and no stated behaviour when the Gateway is down at event-api startup | The event API starts without the Gateway. Generation then fails visibly as `GATEWAY_UNAVAILABLE`. Add `GET /api/health` (Mongo only) for scripts. |
| M22 | No stance on stored-schema versions | `schemaVersion: 1` on the document. A mismatch fails startup clearly, consistent with F1 rule 6. No migration framework. |
| M23 | How CORS and "reject cross-origin mutations" (S1) work in development | The Vite dev proxy serves `/api` from the same origin, so no CORS headers are needed. The API checks `Origin`/`Host` against an allow-list and requires `Content-Type: application/json`. |
| M24 | Astryx is built on StyleX, and Vite needs the StyleX compiler plugin; untested | Check the Astryx + Vite + React 19 setup in the first scaffold step, before writing any UI. |
| M25 | Agents SDK details that S1 depends on (disabling SDK retries, `store: false`, tracing off, `maxTurns: 1`, abort on deadline) | List them in T3 §8 and verify them against the installed SDK version. Each one has a test. |
| M26 | The final hand-in README (run/reset commands, trade-offs, validation limits, reused boilerplate) has no owner | Make it a tracked deliverable in the build order (T3 §12). |

---

## 3. Scope risk (not a defect)

The brief asks for a compact app: 4 members, 8 notes, one coordinator. The confirmed additions (a separate TCP Gateway, a fixed-window FIFO queue with cooldowns and unknown-outcome handling, an automatic note-arrival trigger with no producer, and Redis) are mostly **infrastructure the brief does not require**, and F7 alone is longer than F1 and F2 combined. These choices are yours and are not reopened here. To keep delivery safe:

1. Build the brief's core workflow (F1–F6) end to end first. Generation can go through the Gateway with a minimal queue (window plus FIFO, no retries).
2. Add F7 hardening (retries, cooldown, unknown outcome, capacity) in a second pass.
3. Implement the note-arrival trigger as an internal service entry point exercised only by tests (F7-09 already accepts "explicitly unverified"). Do not build an ingress for it.

This order is reflected in T3 §12.

---

## 4. Things that are right and should not change

- Building the attendance overview deterministically in code (F4). It closes the main way a model could get the counts wrong.
- Validating references against the **job snapshot**, not the current feedback (F4 rule 3).
- Separate incoming and selected slots, so a background result can never move the editor's base (F7).
- A single retry owner (the event queue), with SDK and RPC retries disabled (F7/F8).
- Stating honestly that structural reference checks are not semantic verification (F3/F4/S1).
