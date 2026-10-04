# F7 — Automatic briefing generation from feedback batches

[All specifications](README.md) · [Generation content rules](04-ai-briefing-generation.md) · [OpenAI security](08-openai-security.md) · [AI Gateway](09-ai-gateway.md) · [Queue implementation (T5)](14-generation-queue-implementation.md)

Status: **Confirmed by the user on 2026-10-03.** This replaces the earlier "latest request wins + FIFO winners" design (former D9). Amended 2026-10-04 (user-approved): UI labels — the coordinator's save button reads **Save**, the manual button **Generating…** while busy, and the failed-batch banner's button **Generate now**.

- **Automatic batching.** When new feedback notes arrive for an event, they are batched in a fixed window, and each window produces **one** generation that uses all of the event's notes at that moment.
- **Manual generation bypasses the queue.** The coordinator's **Generate** does not use the queue. It runs synchronously ([F4](04-ai-briefing-generation.md#generation-flow)) and **takes priority** over automatic work.
- **Implementation.** BullMQ (confirmed 2026-10-03); details in [T5](14-generation-queue-implementation.md).

## Outcome and scope

When feedback arrives in bursts (for example, five notes submitted within a few seconds), the coordinator gets one up-to-date automatic briefing candidate instead of five overlapping paid model calls. Automatic work never disturbs the coordinator's own generation, open editor or saved briefing.

Contribution to the [client goal](README.md#product-goal-solve-the-client-situation): keep a useful candidate briefing available as feedback comes in, without wasting model calls or confusing older and newer evidence.

## Triggers

| Event | Behaviour |
| --- | --- |
| A new feedback note is saved ([F3](03-feedback-and-sources.md#adding-feedback-test-extension) form or script) | Join the event's open batch window, or open one. Never generate per note. |
| The coordinator selects **Generate** or **Retry** | **Not queued.** Synchronous generation under [F4](04-ai-briefing-generation.md#generation-flow), with priority over automatic work (see "Coordinator priority" below) |
| Attendance is saved | Mark earlier content out of date ([F6](06-freshness-and-regeneration.md)); no automatic generation |
| Page load, read or backend restart | No generation, except re-scheduling a batch for notes that were saved but never scheduled (see "Durability") |

Seeding F01–F08 does not trigger generation.

## Batching rule

1. **Configuration.** `BRIEFING_BATCH_WINDOW_MS`, default **3000**, must be a positive integer; invalid values fail startup. Clients and note text cannot change it.
2. **Fixed window.** The first saved note while no window is open starts a window `[openedAt, openedAt + windowMs)`. Notes saved inside it add nothing to the queue, and **the cutoff never moves**: this is a fixed window, not "wait for 3 quiet seconds".
3. **One job per window.** At the cutoff the window's single job becomes ready. A note saved at or after the cutoff opens the next window.
4. **Data read at execution time.** When the job starts, it reads the event's **complete current feedback set and saved attendance** in one consistent read. Every note saved before that moment is included, even if it arrived after the cutoff while the job was waiting.
5. **One batch job runs at a time.** If the worker is busy, a newer ready job makes older waiting ones redundant: an older job is skipped as `superseded`, because the newer one reads at least the same data.
6. **Nothing new, no call.** If the captured input (per-member attendance and the note ID set) equals the input of the most recent generation for the event, whether manual or automatic, the job finishes as `skipped` without calling the AI Gateway.

Example with the default window and an idle worker:

| Time | Event | Result |
| --- | --- | --- |
| 0.0 s | F09 saved | Window opens, closing at 3.0 s; job created as delayed |
| 0.4 s, 1.2 s, 2.0 s, 2.9 s | F10–F13 saved | No new jobs; the cutoff stays at 3.0 s |
| 3.0 s | Cutoff | One job runs. It reads F01–F13 and saved attendance, then makes one Gateway call. |
| 3.5 s | F14 saved | A new window opens, closing at 6.5 s. If the 3.0 s job is still running, this one waits. |

Five notes in one window produce exactly one generation.

## Coordinator priority

A coordinator generation is **never queued behind, blocked by, or overwritten by** automatic work:

- **Own Gateway lane.** Manual calls use the Gateway's `interactive` lane and batch jobs use the `background` lane, each with concurrency 1. A running batch call never delays a manual call.
- **Batch waits for manual.** A batch job that becomes ready while a manual generation for the same event is running waits for it to finish, then applies the "nothing new" check. Typically it skips, avoiding a duplicate paid call.
- **Manual results win in the incoming slot** (rules below).
- **Reserved budget.** Batch jobs may use at most `GENERATION_BATCH_DAILY_LIMIT` (default 15) of the daily attempt budget (`GENERATION_DAILY_ATTEMPT_LIMIT`, default 20). The rest is reserved for the coordinator.
- **What still applies.** The shared provider cooldown applies to both paths, because the provider's rate limit is real. A manual request during a cooldown gets a clear `429` with the time to wait.

### Who may replace the incoming preview

| Incoming slot holds | New result | Replace? |
| --- | --- | --- |
| Nothing | Any | Yes |
| Automatic result | Manual result | Yes |
| Automatic result | Automatic result with data read later | Yes |
| Manual result | Manual result with data read later | Yes |
| Manual result not yet reviewed | Automatic result | **No.** Recorded as outcome `superseded_by_manual`; the manual result's freshness shows the newer notes, and the coordinator can Generate again |
| Any | Result whose data was read earlier than the current one's | No (`superseded`) |

The worker never writes the saved briefing or the selected preview (the editor's base). After a successful manual generation, the UI selects the result automatically if the editor has no unsaved changes. Otherwise it shows **Review new preview** ([F5](05-briefing-editor.md)).

## Preview ownership and the editor

| Slot | Who may replace it? | Purpose |
| --- | --- | --- |
| Saved briefing | Coordinator's explicit Save (from the edit view of the saved briefing or of the selected preview) | Durable human-approved wording |
| Selected generated preview | Coordinator's explicit selection (manual: automatic when the editor is clean) | Stable server-owned structure, sources and provenance for the editor |
| Incoming preview | Manual or batch generation, under the rules above | Latest candidate waiting for review; holds no human edits |

Selecting incoming content requires its exact generation ID and the expected selected-preview ID (or `null`). A changed selection returns `409` rather than silently binding the editor to another generation. If the selected preview has local edits, offer Save, a confirmed Discard, or Cancel before switching.

## Generation state in the UI

The coordinator sees automatic work as it happens, in the briefing panel. All states are in text, not just colour, and announced through a polite live region:

| State | Example text |
| --- | --- |
| Collecting | "New feedback received (3 notes). Preparing an automatic briefing at 14:02:03." |
| Waiting | "Automatic briefing queued; waiting for the current generation to finish." |
| Generating | "Generating automatic briefing…" |
| Retry wait | "Automatic briefing will retry at 14:02:40 (attempt 2 of 3)." |
| Ready | "New automatic briefing ready to review." |
| Skipped | No banner, since there was no new input; the outcome is visible in the status details only |
| Failed | "Automatic briefing failed: AI service unavailable. Your saved briefing is unchanged." with a **Generate now** button |

The manual generation state ("Generating…" on the button, "Generating briefing…" in the panel) is shown separately, so both can be visible at once.

**How the page learns about changes.** The event page subscribes to `GET /api/events/E101/changes` (Server-Sent Events). The server sends a `changed` message whenever the event view changes: a new note, batch state, result, or save. The client then re-fetches the cached event read. Notes added by the script or another tab therefore appear without a reload. If the stream disconnects, the page falls back to polling every 5 s (every 1 s while a batch is collecting or generating).

## Durability

- **Pending flag.** Saving a note and setting `events.feedback_pending_since` happen in **one** transaction ([T4](13-data-model-and-transactions.md) TX9). The batch job is scheduled after commit.
  - If scheduling fails, the note is still saved, and the response says the automatic briefing is deferred.
  - On startup, and whenever a note is saved, the backend re-schedules a batch if the pending flag is set and no batch job exists.
  - A batch job clears the flag in the same transaction that reads its input.
- **Restarts.** The window's cutoff and the waiting job survive a restart (Redis with AOF). A restart never starts a full new window for notes already covered.
- **Crash mid-call.** A batch job interrupted after its Gateway request was sent ends as `AI_OUTCOME_UNKNOWN` and is not replayed automatically. A job interrupted before sending resumes.
- **Idempotent commit.** A result commit is idempotent per run ID, so a crash after commit cannot produce a second paid call.

## Failures, retries and cost limits

- **Retries.** A batch job may retry known pre-dispatch connection failures, explicit temporary Gateway/provider errors and temporary rate limits. It makes at most **3 attempts** within a **5-minute** execution deadline, with exponential backoff, jitter, and the provider cooldown honoured. Because each job reads current data, a retry never processes stale input in a way that matters: a later job would supersede it.
- **No retry loops.** Configuration/authentication errors, exhausted quota, refusal, and invalid or incomplete output fail the job without retrying.
- **Uncertain dispatch** (`AI_OUTCOME_UNKNOWN`) is never retried automatically.
- **Single retry owner.** The queue is the only retry owner for automatic work. Gateway, TCP client and OpenAI SDK retries stay disabled ([F8](09-ai-gateway.md#deadlines-retries-and-uncertain-outcomes)).
- **Manual generation** never retries automatically. The UI's **Retry** button is simply Generate again ([F4](04-ai-briefing-generation.md#generation-flow)).
- **Failures preserve work.** A failure never changes the saved briefing, the selected preview or the incoming preview.

## Acceptance criteria

| ID | Scenario | Expected result |
| --- | --- | --- |
| F7-01 | Five notes saved within 1 second, idle worker | Exactly one batch job and one Gateway call at the cutoff; the result's input includes all five new notes plus F01–F08 |
| F7-02 | Notes keep arriving at 0.0 s, 1.0 s, 2.9 s | The cutoff stays at 3.0 s; there is no extension |
| F7-03 | A note arrives at or after the cutoff | It opens a new window; its job runs after the current one |
| F7-04 | A note arrives after the cutoff but before the job starts (worker busy) | That job includes the note; the next window's job skips as "nothing new" |
| F7-05 | Worker busy through several windows | Only the newest ready job calls the Gateway; older ready jobs end `superseded` |
| F7-06 | Coordinator presses Generate while a batch job is running | Manual call starts immediately on the interactive lane; its result is never replaced by that batch result |
| F7-07 | Batch window closes while a manual generation is running | Batch waits, then skips if the input equals the manual generation's input |
| F7-08 | Manual result is unreviewed in the incoming slot; a later batch completes with newer notes | Incoming keeps the manual result; batch outcome `superseded_by_manual`; manual result shows "new notes since this briefing" |
| F7-09 | Restart while a window is collecting | The original cutoff still applies; one job runs |
| F7-10 | Crash after the note commit, before scheduling | On restart the pending flag re-schedules one batch |
| F7-11 | Crash during a batch Gateway call | `AI_OUTCOME_UNKNOWN`; no automatic replay; existing content intact |
| F7-12 | Temporary provider error on a batch job | Bounded retries with backoff and cooldown; saved and selected content untouched |
| F7-13 | The batch share of the daily budget is used up | Batch jobs fail visibly with `DAILY_LIMIT_REACHED`; manual Generate still works until the full limit |
| F7-14 | A batch completes while the coordinator is editing | Editor fields, focus, selected generation and references unchanged; "New automatic briefing ready" notice appears |
| F7-15 | Notes added by the script while the coordinator page is open | The new notes, collecting/generating states and the ready notice appear without a reload |
| F7-16 | Change `BRIEFING_BATCH_WINDOW_MS` to 5000 or to an invalid value | New windows last 5 s; an invalid value fails startup |
