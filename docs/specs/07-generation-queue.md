# F7 — Queued briefing generation

[All specifications](README.md) · [Generation content rules](04-ai-briefing-generation.md) · [OpenAI security](08-openai-security.md) · [AI Gateway](09-ai-gateway.md)

Status: **Ordered generation with a configurable 3-second collection window confirmed by the user on 2026-10-02.** Within each window, only the latest generation request is selected; earlier requests are omitted. The timing, persistence and failure details below specify that behaviour. The original brief does not require a queue or a feedback-ingestion feature. Feedback remains read-only to the coordinator and is treated as untrusted user input. No queue library, broker or production dependency is approved by this document.

## Outcome and scope

Prepare a briefing in the background while allowing the coordinator to read notes, inspect sources and edit existing briefing text. Both automatic and manual triggers use the same generation logic and safety checks.

Contribution to the [client goal](README.md#product-goal-solve-the-client-situation): make a useful candidate available without losing reviewed work or confusing older feedback with current evidence.

## Triggers and the feedback boundary

| Trigger | Behaviour |
| --- | --- |
| Coordinator selects Generate or Regenerate | Join the collection window from saved input, or attach to equivalent existing work; the browser resolves unsaved attendance/text first |
| A new feedback note has been durably added by an upstream source | Add a generation request to the collection window after persistence; the coordinator does not add the note |
| Attendance changes | Mark earlier content out of date; do not silently add an automatic attendance-triggered model call |
| Read notes, open the page or restart the backend | Do not create a new generation merely because data was read or reloaded |

The supplied build currently has only F01–F08. The automatic trigger is a backend integration boundary for a future/external note arrival; the actual producer and ingestion mechanism are not yet specified or approved. This proposal adds no feedback form, submission endpoint, public webhook or connector. With only seeded notes, manual generation is available and there are no live note-arrival events. Seed the complete supplied set once; do not issue eight model calls while seeding.

If an upstream integration is later selected, it must preserve stable note IDs, validate the envelope and persist the note plus pending-generation intent atomically (or reconcile missed intent after restart). An upstream identity is trusted only to submit a note; its note text is still untrusted data. Replayed delivery of the same note must not add a duplicate note or another paid job. Those ingestion details must be specified before claiming the automatic path is implemented.

## One queue path

1. Validate the trigger and load the event from backend state. The client does not supply source text, counts, prompts, a model name or an OpenAI URL to the generation endpoint.
2. In one serialized store operation, durably record the request's order and saved attendance/complete feedback snapshot in the open collection window, replacing its previous candidate. Equivalent requests attach to existing work. A window has one stable job ID, so callers continue following that job when its candidate changes.
3. Close the window at its fixed deadline and seal its latest candidate. One worker claims closed-window winners in order, records an attempt identifier and uses the winning snapshot. Neither waiting nor starting the worker reloads newer inputs into that job.
4. Call the internal AI Gateway over TCP using [F8](09-ai-gateway.md). Only the Gateway calls OpenAI. Validate the returned candidate against the saved snapshot using shared schemas and the rules in [F4](04-ai-briefing-generation.md)/[S1](08-openai-security.md).
5. Atomically commit the validated result and successful job state only if this attempt still owns the job. Reject late results from timed-out or superseded attempts.
6. Put the result in the incoming-preview slot. It never writes the saved briefing or the preview currently selected for editing.
7. The UI announces **New briefing ready to review**. The coordinator chooses when to inspect it, select it for text editing and save it.

Automatic work uses saved attendance even if an open browser has unsaved selections. Keep that browser's unsaved marker visible; do not suggest the background result includes its local changes. Manual Generate remains disabled until its local attendance draft is saved or discarded.

## Fixed collection windows and ordering

Here a **generation request** is the notification to prepare a briefing, not a feedback note or the club event E101. **Omit earlier generation requests, never their notes.** The winner contains the complete saved feedback set as of that request, including notes whose individual triggers were omitted. Apply source limits without silently dropping notes.

1. Use a backend setting `BRIEFING_GENERATION_WINDOW_MS`, default **3000 milliseconds**. Require a positive integer; invalid configuration fails startup. Clients, note text and the Gateway cannot override it. A configuration change affects newly opened windows only.
2. The first accepted request while no window is open starts `[openedAt, closesAt)`, with `closesAt = openedAt + windowMs`. There is no repeating timer while idle. Requests arriving during this interval replace the candidate, **without extending the deadline**. This is a fixed window, not a wait for three quiet seconds.
3. Order requests by a backend-assigned increasing sequence within the serialized admission operation, not client timestamps, note IDs or socket arrival order. The highest accepted sequence before the cutoff wins. Equal-time arrivals therefore have a deterministic order. This is queue ordering, not attendance revision history.
4. At the cutoff, seal the winner and append it to the FIFO of ready jobs. No Gateway call starts before the cutoff. A request accepted exactly at or after the cutoff opens the next window; the admission operation closes an expired window first, even if its timer callback is late.
5. Keep **one running job, one open collection window and a bounded FIFO of closed-window winners**. A slow Gateway call does not extend a window or allow later windows to replace earlier winners. Dispatch winners oldest first; never process a newer winner concurrently or skip a queued winner merely because fresher notes exist.
6. Freeze each winner's saved attendance/counts and complete feedback ID/text snapshot. Later arrivals enter another window and never mutate a sealed or running job. Retries use that same snapshot. Compute freshness against current saved input when publishing or displaying the result, even if it became stale while waiting.

Example with the default window and an idle worker:

| Backend acceptance time | Request | Result |
| --- | --- | --- |
| `0.0s` | A after a note is saved | Open the window ending at `3.0s`; no AI call |
| `1.0s` | B after another note is saved | Replace A as the candidate; cutoff remains `3.0s` |
| `2.9s` | C after another note is saved | Replace B; C's input includes all saved notes, including A's and B's |
| `3.0s` cutoff | Select C | Only C becomes eligible for a Gateway call; A and B cause no calls |
| `3.0s` or later | D | Open a new 3-second window; its winner waits behind C if C is still running |

The cutoff is an eligibility time, not a guaranteed provider start or completion time. A busy worker, retry cooldown or usage limit can delay dispatch. Only the selected job may use the existing bounded retry policy; omitted requests are never retried. Thus one winner per window does not promise one network attempt if that winner encounters a retryable failure.

Manual and automatic triggers share these rules. A manual request for the same saved inputs as collecting/queued/running work attaches to that job without starting or extending a window. A different saved input updates the open window or opens a new one. Explicit Regenerate after completion starts a new window, subject to limits. Manual action does not bypass the collection delay.

## Durability and bounded backlog

- Persist the open window's fixed cutoff, latest candidate/order/snapshot, closed winners in FIFO order and successful results. On restart, resume the remaining window time or close it immediately if expired; do not restart a full 3-second wait or combine it with later arrivals.
- A running job with uncertain Gateway/provider dispatch becomes `AI_OUTCOME_UNKNOWN` and requires coordinator Retry for that job; only a provably undispatched attempt may retry automatically under the bounded policy. New, separately accepted jobs keep their own order and input.
- An automatic retry stays with its current job at the head of the queue; it does not create a new generation event or window. Later winners wait until that job succeeds or reaches a terminal state. Completion removes only that job, never the open window or other queued winners.
- Compare both attendance and feedback inputs for freshness. If either changed, label the result out of date. Never let an older completion displace a newer available result.
- Bound waiting work. Proposed initial capacity: **10 waiting jobs**, counting the open window plus closed winners and excluding the active job. Updating an existing open window or attaching to equivalent work does not consume another slot. If a new window cannot fit, return a retryable `QUEUE_FULL` (`429` for manual requests); never evict an acknowledged winner.
- The future upstream integration must handle backpressure durably: persist a note and its generation intent atomically, or retain/retry an unacknowledged trigger for an already persisted note. Queue-full must not delete feedback, acknowledge a dropped trigger or create an unbounded hidden backlog. No such integration is claimed implemented here.
- Store enough request/attempt identity to reject late completion. This does not promise exactly-once provider execution or billing: a timed-out request may already have reached OpenAI.

Keep one worker in the event-backend process. MongoDB through Mongoose is the selected domain store, and Redis is selected for API response caching under [T2](11-backend-technologies.md). BullMQ is a queue recommendation, not a confirmed selection; MongoDB-backed job state remains an alternative. If a Redis queue is chosen, explicitly reconcile the MongoDB-write/queue-enqueue boundary and protect durable queue data from cache eviction. Whichever implementation is selected must preserve the fixed windows, FIFO including retries, recovery and atomic result/state requirements above. The AI Gateway remains a separate process with no second queue or event-store access. Job state is operational data, not attendance history or an audit subsystem.

Keep the minimal job metadata: job ID, trigger, collecting/queued/running/succeeded/failed state, window open/cutoff times and configured duration, latest request sequence, winning input snapshot, attempt count/current attempt ID, next-attempt time when waiting, execution deadline and sanitised terminal error/result identity. Retain only collecting/queued/running work and the latest terminal status needed by the page; do not keep omitted requests as runnable jobs or create an audit history. Keep selected/saved generation data independently so job cleanup cannot remove an editor's base.

## Preview ownership and the editor

| Slot | Who may replace it? | Purpose |
| --- | --- | --- |
| Saved briefing | Coordinator's explicit Save / Save and replace briefing | Durable human-approved wording |
| Selected generated preview | Coordinator's explicit Review new preview selection, after resolving local edits | Stable server-owned text structure, sources and provenance for the editor |
| Incoming preview | Successful worker completion, only with a result newer than its current content | Latest candidate waiting for review; no human edits are stored here |

This bounded pair of generated previews protects an editor's base while allowing automatic generation. It is not full version history. **Review new preview** changes only the selected preview; **Save and replace briefing** changes the saved briefing. An automatic result must not change editor fields, focus, selected generation or source associations.

Selecting incoming content requires its exact generation ID and the expected selected-preview ID (or `null`). Reject a changed selection/result with `409` rather than bind the editor to another generation silently. If the selected preview has local human edits, offer Save, explicitly confirmed Discard, or Cancel before switching. Preserve the server base until that selection succeeds. Another tab's explicit conflicting selection returns a clear conflict on later saves and retains the local text draft.

## Proposed API and UI states

| Operation | Contract |
| --- | --- |
| `POST /api/events/E101/briefing-preview` | Collect/attach to work; return `202` with stable `{ jobId, state }`, not a finished briefing. An optional attendance baseline check may reject an outdated manual request |
| `GET /api/events/E101` | Include collecting cutoff, active job, bounded queued-job status/order, saved briefing, selected `generatedPreview`, `incomingPreview` and their freshness; reuse this read for bounded polling |
| `POST /api/events/E101/briefing-preview/select` | `{ generationId, expectedPreviewGenerationId }`; return `200` with selected preview; never save the briefing implicitly |

Poll only while work is collecting/queued/running and stop when no work remains or on leaving the page. Show **Collecting requests**, **Queued**, **Generating**, retry-wait, ready and failed states distinctly. During collection, explain that the latest request will use all saved notes in its snapshot. Superseded triggers remain attached to the stable window job; do not report them as failed. A ready incoming candidate can coexist with later waiting jobs. Do not hold an HTTP request open for the window or model call. Automatic completion is a notification in this page, not email or messaging.

The existing text-only save endpoint still accepts only the selected preview or saved briefing's generation ID. Saving an incoming candidate requires selecting it first. This prevents an automatic job from invalidating the server-owned references of a preview being edited.

## Failures, retry and cost limits

Proposed defaults: one active Gateway generation request, at most three total attempts per job, a 60-second RPC attempt deadline and a five-minute execution/retry deadline starting with the first attempt. Gateway enforces a provider timeout within the supplied deadline and its own limit. These are reviewable operational limits, not brief requirements.

Retry known pre-dispatch connection failures, explicit temporary Gateway/provider errors and temporary rate limits with backoff and jitter, following [F8](09-ai-gateway.md#deadlines-retries-and-uncertain-outcomes). Honour the Gateway's validated provider cooldown; if it exceeds the remaining job deadline, fail/defer visibly rather than retry earlier. Configuration/authentication errors, exhausted quota/billing, refusal and invalid/incomplete output do not enter automatic retry loops. A connection loss after submission or uncertain provider timeout becomes `AI_OUTCOME_UNKNOWN` and requires coordinator Retry for that failed job. Explicit Retry after a terminal outcome enters the same collection-window path from current saved inputs, with fresh job/attempt identity and any cooldown preserved; it cannot jump ahead of queued winners. Collection and FIFO waiting do not consume provider attempts or the execution/retry deadline, which starts at the first attempt.

Persist the validated provider cooldown as a shared backend not-before time for this queue, taking the later of any existing and newly received deadline. Apply it to every job and preserve it across restart. If the head job reaches a terminal state, the next FIFO winner still waits until the cooldown expires; failing a job or starting a fresh manual request cannot bypass it.

The event queue is the sole retry owner. Disable automatic retries/resends in the Gateway, TCP client and the Gateway's OpenAI SDK so layers cannot multiply attempts. OpenAI documents bounded retries and avoiding nested retry multiplication in its [rate-limit guidance](https://developers.openai.com/api/docs/guides/rate-limits#retrying-with-exponential-backoff).

Queue persistence failure returns an error rather than a successful enqueue. A model/result-save failure keeps the previous saved briefing and both preview slots intact. For a lost enqueue response, look up current job state before requesting another run. Cap pending work and model usage as described in [S1](08-openai-security.md#resource-and-cost-controls).

## Acceptance criteria

| ID | Scenario | Expected result |
| --- | --- | --- |
| F7-01 | Manual Generate | Durable collecting job acknowledged; fixed window applies; clear progress; winner becomes available for review |
| F7-02 | Several copies of the same trigger arrive | One equivalent collecting/queued/running job; no extended cutoff or duplicate note/model call from delivery replay |
| F7-03 | Notes arrive across multiple windows during generation | Running input unchanged; one winner per window waits FIFO; older output cannot appear current and no winner is replaced across windows |
| F7-04 | Worker finishes while coordinator types in a selected preview | Draft, selected generation and source references remain saveable; new candidate is only announced |
| F7-05 | Select incoming preview, edit text and save | Selection does not replace saved work; only explicit Save and replace does |
| F7-06 | Restart during collecting/queued/running work | Original cutoff, winner snapshots and FIFO order recover; expired window closes without another full wait; uncertain dispatched work requires coordinator Retry |
| F7-07 | OpenAI fails or rejects the request | Correct failed/retry-wait state; retries bounded; saved human content preserved |
| F7-08 | Unsaved local attendance exists during automatic work | Worker uses saved records; UI keeps unsaved warning; no automatic local save |
| F7-09 | Only seeded feedback exists | No invented ingestion endpoint; manual generation works; automatic-trigger integration remains explicitly unverified |
| F7-10 | Candidate already available and generation is retried | Newer result cannot overwrite selected/editor content or saved briefing; only unreviewed incoming slot may change |
| F7-11 | Gateway unavailable or TCP result lost after submission | Follow bounded/unknown-outcome rules; no direct OpenAI fallback and no automatic replay of uncertain paid work |
| F7-12 | A at `0s`, B at `1s`, C at `2.9s`, no failures | No call before `3s`; exactly one Gateway call for C when worker is free; all saved notes from A/B/C included |
| F7-13 | Request accepted exactly at the cutoff, or timer callback is delayed | Previous window closes first; request belongs to the next window; backend sequence breaks equal-time ties |
| F7-14 | Worker is busy through three completed windows | Their three winners remain queued in order; each keeps its own snapshot; no concurrent dispatch or cross-window replacement |
| F7-15 | Configure 5 seconds, or change configuration with an open window | New windows use 5 seconds; existing cutoff stays fixed; invalid values rejected; repeated arrivals do not postpone the cutoff |
| F7-16 | Manual request shares a window with new-note triggers | Stable acknowledged job ID follows the latest candidate; no early manual call, failed superseded status or lost notes |
| F7-17 | Queue reaches waiting capacity | New window is rejected/deferred visibly; existing-window updates still fit; accepted winners and source notes remain intact |
| F7-18 | Head job receives a retryable error while newer winners wait | Retry uses the same snapshot/queue position and bounded policy; no new window, revived omitted request or overtaking |
| F7-19 | Head job fails with an unexpired provider cooldown, then backend restarts | Next winner retains FIFO position and waits for the persisted shared cooldown; no new-job or restart bypass |
