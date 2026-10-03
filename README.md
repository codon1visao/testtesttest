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
