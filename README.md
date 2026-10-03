# Event Desk

A coordinator tool for **Harbour Community Club**. It keeps a reliable attendance record for an ended event and turns short, anonymous feedback notes into an evidence-backed briefing: **what happened, which themes recur, where people disagree, and what might be worth following up.** The coordinator inspects every cited note, edits the wording, and saves it. Saved human work is never overwritten by a new generation.

This build serves one seeded event, **E101 · Saturday Walk**, with four registered members (Alex, Bea, Chris, Drew) and eight supplied notes (F01–F08), as specified in the [project brief](docs/project-brief.md).

| Part                | What it is                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/web`          | React coordinator app (and a test feedback form)                                                          |
| `apps/event-api`    | Node.js/Express API: attendance, briefings, generation, batches, live updates                             |
| `apps/ai-gateway`   | The only process that talks to OpenAI; called by the event API over an authenticated local TCP connection |
| MySQL 8.4 · Redis 8 | Durable records · cache, batch queue, cooldown and budget (Docker Compose)                                |

## Quick start

**You need:** Node.js 24 (see `.nvmrc`), pnpm 11 (`corepack enable` picks the pinned version), Docker with Compose, and — only for AI generation — an OpenAI API key.

```bash
pnpm install
cp .env.example .env          # local-only defaults; add OPENAI_API_KEY to enable generation
pnpm infra:up                 # MySQL 8.4 and Redis 8 on 127.0.0.1
pnpm dev                      # AI Gateway, event API and web app together
```

Open **http://localhost:5173**. On a fresh database it opens E101 with the brief's starting counts: 4 registered · 1 attended · 2 absent · 1 not recorded.

- The first start of the event API creates the schema and seeds E101 once. Later starts keep everything you saved.
- **Without an OpenAI key** everything works except generation: Generate answers "The AI service has no provider configured", and nothing you saved changes.
- **Without the AI Gateway running** Generate answers that the AI service is not reachable; the rest of the app is unaffected.
- The test feedback form is at **http://localhost:5173/events/E101/feedback** (also linked from the Feedback panel as "Open feedback form (test)").

## Using it: the coordinator flow

| The brief's outcome         | What to do in the app                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Record attendance**       | Change a member's status. The counts update at once, labelled unsaved; **Save attendance** stores them. A change saved in another tab is detected (you get a conflict, not a silent overwrite). Saved records survive refresh and restart.                                                                                                                                                                                                                  |
| **Review feedback**         | The Feedback panel lists each note with its stable ID (F01…). Notes are read-only and not linked to members.                                                                                                                                                                                                                                                                                                                                                |
| **Generate an AI briefing** | **Generate briefing** (available once attendance changes are saved or discarded) calls the model through the AI Gateway and opens the result as a **generated preview** (if the editor has no unsaved text). The briefing answers the four questions: _What happened_ (a code-built attendance overview plus a cited feedback summary), _Which themes recur_, _Where people disagree_, _What might be worth following up_. Every item shows its source IDs. |
| **Inspect and edit**        | **Read source F05** opens the cited note inline. Edit the wording of any item (structure and references stay fixed), then **Save briefing** — or **Save and replace briefing** when a saved briefing already exists.                                                                                                                                                                                                                                        |
| **Keep work trustworthy**   | Save an attendance change and the briefing says **"Out of date — attendance changed since this briefing was generated"**, naming the change ("Chris: Not recorded → Attended"). Generating again creates a separate preview; only an explicit save replaces your saved briefing. Failures are shown in words, and your text is kept.                                                                                                                        |

**Beyond the brief (confirmed extensions):** new notes can be added through the test feedback form or `pnpm feedback:simulate`. Notes that arrive close together are batched (a fixed 3-second window) into **one** automatic generation, which appears as "New automatic briefing ready to review." and never disturbs your editor or your own Generate. The page updates live; notes from the form or script appear without a reload.

## Commands

| Command                             | What it does                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | AI Gateway (127.0.0.1:4100, TCP), event API (http://127.0.0.1:4000) and web app (http://localhost:5173; Vite proxies `/api` to the API)                                                                                                                                                           |
| `pnpm infra:up` / `pnpm infra:down` | Start / stop MySQL and Redis (Docker Compose, loopback ports)                                                                                                                                                                                                                                     |
| `pnpm db:reset`                     | Explicit reset — see [Resetting the data](#resetting-the-data)                                                                                                                                                                                                                                    |
| `pnpm feedback:simulate`            | Posts test notes to the running API: `--count 5 --interval-ms 200 [--text-file notes.txt]`. A burst inside one window makes one automatic briefing (one paid call with a real key)                                                                                                                |
| `pnpm verify`                       | Prettier, ESLint, type-check, architecture rules (dependency-cruiser) and unit tests                                                                                                                                                                                                              |
| `pnpm test`                         | Unit tests only (Vitest)                                                                                                                                                                                                                                                                          |
| `pnpm test:integration`             | Integration tests against the `event_desk_test` database and Redis DB 1 (needs `pnpm infra:up`)                                                                                                                                                                                                   |
| `pnpm e2e`                          | Playwright end-to-end tests on their own ports (4010, 4199, 5183), against `event_desk_test` and Redis DB 2, with a scripted fake AI Gateway (needs `pnpm infra:up` and `pnpm --filter @event-desk/e2e exec playwright install chromium`); don't run it at the same time as the integration tests |
| `pnpm smoke:live`                   | Manual real-model check through the running Gateway (needs a key); `--hostile` adds a prompt-injection note. Never run in CI                                                                                                                                                                      |
| `pnpm build`                        | Compiles the Node packages and builds the web bundle                                                                                                                                                                                                                                              |

## Configuration

All settings come from environment variables. `.env.example` lists every one with local-only defaults; copy it to `.env`. Each app reads **only its own** keys from `.env`, so the event API never sees the OpenAI key. Invalid values stop the app at startup with a message naming the variable.

| Variable                                                          | Default                                               | Used by               | Meaning                                                                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                                                  | (empty)                                               | Gateway               | Enables generation. Empty → Generate answers "no provider configured"                                                            |
| `OPENAI_MODEL`                                                    | `gpt-5-mini` (set in `.env.example`)                  | Gateway               | Model used for generation; required when a key is set                                                                            |
| `GATEWAY_SERVICE_SECRET`                                          | local-only value                                      | API, Gateway          | Shared secret for the internal TCP calls (≥ 32 bytes; generate one with `openssl rand -hex 32` for anything beyond your machine) |
| `MYSQL_URL` / `REDIS_URL`                                         | local Compose services                                | API                   | Durable store / cache, queue and limits                                                                                          |
| `PORT` / `GATEWAY_PORT`                                           | `4000` / `4100`                                       | API / API and Gateway | Ports of the event API / the AI Gateway (both bind to loopback only)                                                             |
| `ALLOWED_ORIGINS` / `ALLOWED_HOSTS`                               | `http://localhost:5173` / `localhost,127.0.0.1,[::1]` | API                   | Origins allowed to change data (cross-origin changes are rejected) / hosts accepted on every request                             |
| `BRIEFING_BATCH_WINDOW_MS`                                        | `3000`                                                | API                   | Fixed batch window for automatic briefings                                                                                       |
| `GENERATION_DAILY_ATTEMPT_LIMIT` / `GENERATION_BATCH_DAILY_LIMIT` | `20` / `15`                                           | API                   | Daily paid-attempt budget, and the share automatic batches may use                                                               |
| `MANUAL_GENERATION_TIMEOUT_MS`                                    | `60000`                                               | API                   | Deadline of one Generate (max 85 s; the browser waits 90 s)                                                                      |
| `FEEDBACK_SUBMISSION_ENABLED` / `FEEDBACK_MAX_NOTES_PER_EVENT`    | `true` / `100`                                        | API                   | The test feedback channel and its note limit                                                                                     |
| `GATEWAY_DAILY_CALL_LIMIT`                                        | `40`                                                  | Gateway               | Independent in-memory daily backstop on provider calls                                                                           |

The remaining variables (timeouts, cache TTL, log level, token limit) are documented inline in `.env.example`.

## Resetting the data

Saved work survives restarts on purpose; resetting is a deliberate developer step. The reset needs MySQL and Redis running (`pnpm infra:up`) and targets the database named in `MYSQL_URL` (`event_desk` with the default `.env`).

```bash
# 1. Stop pnpm dev (the event API and the AI Gateway).
# 2. Reset:
pnpm db:reset
# 3. Start again: the event API recreates the schema and reseeds E101 with F01–F08.
pnpm dev
```

`pnpm db:reset`:

- **refuses to run while the event API answers** on its health check (or when it cannot confirm the API is stopped), so no save or returning generation can race it;
- drops and recreates the application database **`event_desk`** — saved attendance, saved briefings, previews, generation snapshots, outcomes and added notes are all removed;
- deletes only this application's Redis keys: **`event-desk:*`** (cache, cooldown, budget) and **`bull:briefing-batch:*`** (the batch queue). It never runs `FLUSHALL` and never touches other databases;
- reads its targets from `.env` and prints what it removed, without printing connection secrets.

Reload the browser after a reset.

## How it works

```mermaid
flowchart LR
  B["Browser<br/>React app"] -- "/api via Vite proxy<br/>same origin" --> API["Event API<br/>Express"]
  API -. "SSE: changed" .-> B
  API -- "transactions,<br/>per-event row lock" --> DB[("MySQL 8.4<br/>durable records")]
  API -- "cache, batch queue,<br/>cooldown, budget" --> R[("Redis 8")]
  API -- "authenticated TCP,<br/>interactive / background lane" --> GW["AI Gateway"]
  GW -- "Agents SDK,<br/>strict Structured Outputs" --> OAI["OpenAI"]
```

- **The event API owns the facts.** Attendance counts are calculated in code from saved records, never by the model and never stored as separate fields. Every write runs in one MySQL transaction that locks the event row first. Side effects (cache flush, live-update message) run only after commit.
- **Generation has two triggers and one pipeline.**
  - **Generate** is synchronous. The API captures the saved attendance and notes, calls the Gateway on the _interactive_ lane, validates the result against that captured input, and stores it as a new preview.
  - **New notes** (test form or script) are batched by a BullMQ job: one job per fixed window, with the window's cutoff never moving. The job reads all notes when it runs, skips when nothing changed, uses the _background_ lane, and retries only known temporary failures (at most 3 attempts in 5 minutes).
  - Both use the same capture → call → validate → commit code, so the rules exist once.
- **The coordinator always wins.** Manual calls have their own Gateway lane and a reserved share of the daily budget. A batch waits for a running Generate and then usually skips. An automatic result never replaces an unreviewed manual one.
- **The AI Gateway is the only process with the OpenAI key.**
  - It holds fixed instructions; the notes travel in a separate data message.
  - It uses strict Structured Outputs, no tools, retries off and tracing off.
  - It enforces deadlines, one call per lane and a daily backstop.
  - The event API reaches it over loopback TCP with a shared secret, and never calls OpenAI itself.
- **Three briefing slots keep human work safe:**
  - the **saved briefing**, changed only by your explicit save;
  - the **selected preview**, the one you are editing;
  - the **incoming preview**, the newest candidate waiting for review.

  Generation only ever writes the incoming slot.

- **Freshness is a comparison, not a flag.** Each generation stores the attendance and note set it read. A briefing is out of date when the saved records differ from that snapshot, and current again if an attendance change is reverted. Saving edited text never clears it.
- **Live updates.** Every committed change flushes the versioned Redis cache of the event read and sends an SSE `changed` message. The page re-reads the event, and polls when the stream is down.
- **One event-API process.** Single-flight Generate, the live-update notifier and the cache-bypass flag are in-process by design (T3 §3); run one instance.

## Repository layout

```text
apps/
  web/           React 19 + Vite: features/ (event, attendance, feedback, briefing, feedback-form), data/ (API, HTTP client, queries, mutations), state/ (Zustand UI state)
  event-api/     Express: modules/ (services + pure domain rules), ports/, repositories/ (TypeORM), integrations/ (Redis, BullMQ, Gateway client), persistence/ (entities, migrations, seed)
  ai-gateway/    TCP server: operations/, ai/ (prompt, OpenAI adapter), limits/
packages/
  contracts/     Zod schemas shared by every boundary (HTTP, TCP, stored rows, model output)
  tcp-rpc/       Length-prefixed JSON over TCP with authentication and loopback-only binding
e2e/             Playwright specs and a scripted fake Gateway
docs/            Brief, specs (F1–F8, S1, T1–T5), ADRs, build plans, reviews, spikes
```

Architecture rules are enforced in CI by dependency-cruiser:

- services depend on ports, never adapters;
- domain folders are pure;
- `typeorm` stays in persistence and repositories, and `bullmq`/`ioredis` in integrations;
- `openai` stays in the Gateway's `ai/` folder;
- the web app's UI never calls HTTP directly.

## Data and API

**Data** (MySQL, normalised; [T4](docs/specs/13-data-model-and-transactions.md)):

- events, members and anonymous feedback notes, with no link between notes and members;
- immutable generations with their captured attendance and note inputs, items and cited sources;
- the two preview slots;
- the saved briefing, which stores only human wording per item.

Composite foreign keys make the database itself reject a citation of a note outside a generation's input, and a saved text that points at another generation's items.

**API** (JSON; same-origin; [T3 §5](docs/specs/12-architecture-and-repository.md)):

| Method and path                                 | Purpose                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                               | MySQL and Redis status                                                                                   |
| `GET /api/events/E101`                          | The whole event view: members, counts, notes, the three briefing slots with freshness, generation status |
| `PUT /api/events/E101/attendance`               | Save attendance (`baseAttendanceRevision` detects a save from another tab)                               |
| `POST /api/events/E101/briefing-generations`    | Generate (synchronous)                                                                                   |
| `POST /api/events/E101/briefing-preview/select` | Open the incoming preview for editing                                                                    |
| `PUT /api/events/E101/briefing`                 | Save the briefing's wording (text only; references come from the server)                                 |
| `POST /api/events/E101/feedback`                | Test channel: add a note (idempotent per `submissionId`)                                                 |
| `GET /api/events/E101/changes`                  | Server-Sent Events: `changed` after every committed change                                               |

Errors are one JSON shape, `{ error: { code, message, field?, retryAfterMs? } }`, with one status per code.

## Decisions and trade-offs

Each decision has a short record in [`docs/adr`](docs/adr/README.md) (context, options, consequences) and its full design in [`docs/specs`](docs/specs/README.md).

| Decision                                                                                                                         | Choice                                                                                                       | Trade-off                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Safe regeneration ([ADR 0002](docs/adr/0002-separate-preview-for-regeneration.md))                                               | A new generation is a separate preview; only an explicit save replaces the saved briefing                    | More slots and states than a confirm-before-overwrite dialog, but human work cannot be lost by a click elsewhere   |
| Text-only edits ([0003](docs/adr/0003-text-only-briefing-edits.md))                                                              | You edit wording; items, order and references stay as generated                                              | You cannot add, remove or re-cite items; in exchange, every saved item keeps verifiable sources                    |
| Store ([0004](docs/adr/0004-mysql-and-typeorm.md), [0016](docs/adr/0016-normalised-schema-with-composite-keys.md))               | MySQL with a normalised schema and composite keys                                                            | More tables than JSON documents, but the database enforces the evidence rules                                      |
| AI boundary ([0005](docs/adr/0005-openai-agents-sdk-in-gateway.md), [0009](docs/adr/0009-internal-ai-gateway-over-tcp.md))       | A separate Gateway process, the only holder of the key, reached over authenticated local TCP                 | One more process and its failure modes (handled as "AI service not reachable")                                     |
| Freshness ([0006](docs/adr/0006-freshness-by-snapshot-comparison.md))                                                            | Compare the stored snapshot with saved records                                                               | Stores per-generation inputs; gives exact "what changed" messages and clears itself after a revert                 |
| Triggers and priority ([0007](docs/adr/0007-generation-triggers.md), [0010](docs/adr/0010-manual-priority-and-fixed-windows.md)) | Generate is synchronous; new notes batch in a fixed 3 s window                                               | A fixed window is simpler and bounded, but a note just after a cutoff waits for the next window                    |
| Batch queue ([0008](docs/adr/0008-bullmq-batch-queue.md))                                                                        | BullMQ with throttle de-duplication and delay                                                                | Redis must run with AOF and `noeviction`; verified first in a spike, and behind a port, so it could be swapped     |
| Conflicts ([0013](docs/adr/0013-conflicts-cite-two-notes.md))                                                                    | A conflict cites at least two distinct notes, one per opposing view                                          | Both sides stay inspectable; a single note with an internal contradiction cannot be a conflict                     |
| Retry ([0014](docs/adr/0014-retry-is-generate-again.md))                                                                         | Retry is Generate again, confirmed first when the last attempt may have been charged                         | No hidden retries on the coordinator's path; the coordinator decides on every paid attempt                         |
| Live updates ([0015](docs/adr/0015-server-sent-events.md))                                                                       | Server-Sent Events with polling fallback                                                                     | One-way and dependency-free; the in-process notifier assumes one event-API instance                                |
| Four questions ([0017](docs/adr/0017-briefing-answers-four-questions.md))                                                        | "What happened" = code-built attendance overview + a cited model summary                                     | The model never writes the counts                                                                                  |
| Cache ([0018](docs/adr/0018-versioned-event-view-cache.md))                                                                      | Versioned Redis cache of the event read                                                                      | A version counter instead of a plain delete closes a stale-write race; reads fall back to MySQL when Redis is down |
| Frontend and backend stacks ([0011](docs/adr/0011-frontend-stack.md), [0012](docs/adr/0012-backend-stack-and-workspace.md))      | React + Vite + React Query + React Hook Form + Zustand + Astryx; Express + TypeORM + Zod; one pnpm workspace | Familiar, well-supported libraries over novelty; shared Zod contracts remove hand-written duplicate types          |
