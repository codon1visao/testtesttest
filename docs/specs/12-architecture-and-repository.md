# T3 — Architecture and repository layout

[All specifications](README.md) · [Frontend technologies](10-frontend-technologies.md) · [Backend technologies](11-backend-technologies.md) · [Data model and transactions (T4)](13-data-model-and-transactions.md) · [Queue implementation (T5)](14-generation-queue-implementation.md) · [Spec review](../reviews/2026-10-03-spec-review.md)

Status: **Confirmed by the user on 2026-10-03.** Every decision in §1 is confirmed. §9 and §13 updated 2026-10-03 to match the implemented AI Gateway (user-approved). Amended 2026-10-04 (user-approved): the Generate button reads **Generating…** while busy and is not offered while the briefing is being edited.

This project must solve the client's problem **and** demonstrate deliberate architecture and code quality. §10 lists the engineering principles that apply to every app and package.

## 1. Decision summary

| # | Area | Decision | Status |
| --- | --- | --- | --- |
| A1 | Workspace | One root pnpm workspace: `apps/*` and `packages/*`. There are no `frontend/` or `backend/` directories. | Confirmed |
| A2 | Shared contracts | `packages/contracts`: isomorphic Zod schemas, types, error codes and pure domain rules | Confirmed (follows A1) |
| A3 | Persistent store (D3) | MySQL 8.4 + TypeORM (`EntitySchema`, migrations). Normalised schema with composite FKs that enforce evidence rules; per-event row lock ([T4](13-data-model-and-transactions.md)) | Confirmed 2026-10-03 (schema in T4) |
| A4 | Response cache | Redis caches the single event read. Every write and queue change flushes it with a version bump + delete (§7). | Confirmed |
| A5 | Concurrency tokens | `attendanceRevision` and `briefingRevision`, for write conflicts only | Confirmed |
| A6 | Coordinator Retry | **No retry endpoint.** The Retry button calls Generate again | Confirmed |
| A7 | Manual generation | **Synchronous, not queued:** generation API → AI Gateway (TCP) → OpenAI. Single-flight per event; **priority** over automatic work (own Gateway lane, wins the incoming slot, reserved budget) ([F4](04-ai-briefing-generation.md#generation-flow), [F7](07-generation-queue.md#coordinator-priority)) | Confirmed |
| A8 | Automatic generation (D7) | New feedback is **batched**: one generation per fixed window, reading all notes at execution time; BullMQ throttle de-duplication + delay ([T5](14-generation-queue-implementation.md)) | Confirmed (BullMQ, 2026-10-03) |
| A15 | Feedback test channels | Separate feedback form page + `pnpm feedback:simulate` script, both posting to `POST /api/events/:id/feedback` ([F3](03-feedback-and-sources.md#adding-feedback-test-extension)) | Confirmed |
| A16 | Live updates | Server-Sent Events `GET /api/events/:id/changes` emit `changed` on every cache flush; the client re-fetches. Polling fallback. | Confirmed 2026-10-03 |
| A17 | Conflict evidence (D12) | A conflict cites **at least two different feedback notes**, one for each opposing view, and the coordinator sees the related follow-up suggestion (§4) | Confirmed |
| A9 | Freshness (D5) | Per-member snapshot comparison: any real status difference (including a swap) is a change; an exact revert matches the records again | Confirmed |
| A10 | Infrastructure | Docker Compose runs MySQL and Redis only; apps run locally | Confirmed |
| A11 | TCP transport | Node `net`, length-prefixed JSON frames, one connection per attempt, shared secret, loopback only | Confirmed 2026-10-03 |
| A12 | Runtime | Node 24 LTS, TypeScript strict, Express 5, TypeORM, BullMQ + ioredis, Zod 4 if `@openai/agents` allows it (else 3.25+), `tsx` dev, `tsc -b` build | Confirmed 2026-10-03 |
| A13 | Tooling (approved 2026-10-03) | pino, Vitest, Supertest, Testing Library, MSW, Playwright, ESLint flat + typescript-eslint, dependency-cruiser, Prettier, `@asteasolutions/zod-to-openapi` (optional) | Confirmed 2026-10-03 |
| A14 | Web routing / origin | **React Router v7 (declarative mode: `<BrowserRouter>` + `<Routes>`)**: `/` → redirect to `/events/E101`; `/events/:eventId` (coordinator); `/events/:eventId/feedback` (test feedback form); `*` not found. Data loading stays in React Query, not router loaders. The Vite proxy serves `/api` from the same origin, so no CORS is needed. | Confirmed 2026-10-03 |

## 2. Repository layout

```text
blackfrost-assignment/
├─ package.json                 # private root: scripts only; "packageManager": "pnpm@10.x"; engines.node ">=24"
├─ pnpm-workspace.yaml          # packages: ["apps/*", "packages/*"]
├─ .nvmrc                       # 24
├─ tsconfig.base.json           # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax
├─ eslint.config.js             # flat config
├─ .dependency-cruiser.cjs      # architecture rules (§10)
├─ .prettierrc
├─ docker-compose.yml           # mysql + redis only (§13)
├─ .env.example
├─ .github/workflows/ci.yml     # lint · typecheck · unit · integration (MySQL/Redis services) · e2e
├─ AGENTS.md                    # working agreements: dependency approval, naming, layering, commands
├─ README.md                    # hand-in: run/reset, env, trade-offs, validation limits, reused boilerplate
├─ docs/
│  ├─ project-brief.md
│  ├─ specs/ …
│  ├─ adr/                      # one short ADR per confirmed decision (store, queue, gateway, cache, freshness…)
│  └─ reviews/
├─ apps/
│  ├─ web/                      # @event-desk/web — React + Vite coordinator UI
│  ├─ event-api/                # @event-desk/event-api — Express HTTP API + BullMQ worker (one process)
│  └─ ai-gateway/               # @event-desk/ai-gateway — TCP server, sole OpenAI caller
└─ packages/
   ├─ contracts/                # @event-desk/contracts — isomorphic; used by all three apps
   └─ tcp-rpc/                  # @event-desk/tcp-rpc — Node-only framing codec, RPC client/server, auth
```

A package exists only when it has more than one consumer. `contracts` has three consumers and `tcp-rpc` has two. Everything else lives inside its app.

## 3. Runtime topology

```mermaid
flowchart LR
  WEB[apps/web · coordinator page + feedback form] -- "/api (same origin via proxy) · SSE /changes" --> API
  SCRIPT[pnpm feedback:simulate] -- "POST /api/events/E101/feedback" --> API
  subgraph event-api process · 127.0.0.1:4000
    API[HTTP controllers] --> SVC[application services]
    W[BullMQ batch worker · concurrency 1] --> SVC
    SVC --> P1[UnitOfWork port] --> ORM[TypeORM adapter]
    SVC --> P2[EventViewCache port] --> RC[Redis adapter]
    SVC --> P3[BriefingBatchQueue port] --> BQ[BullMQ adapter]
    SVC --> P4[AiGatewayClient port] --> TCP[tcp-rpc client]
  end
  subgraph docker compose
    DB[(MySQL 8.4)]
    R[(Redis · AOF · noeviction)]
  end
  ORM --> DB
  RC --> R
  BQ <--> R
  TCP -- "TCP 127.0.0.1:4100 · lanes: interactive / background" --> GW[apps/ai-gateway]
  GW -- HTTPS --> OAI[OpenAI Responses API]
```

Only one event-api instance runs. Manual single-flight, the SSE notifier and the cache-bypass flag rely on that, and the README states it. The API starts without the Gateway; generation then fails visibly with `GATEWAY_UNAVAILABLE`.

## 4. Shared contracts package

```text
packages/contracts/src/
├─ index.ts
├─ ids.ts                   # branded IDs: EventId, MemberId, FeedbackId, GenerationId, JobId
├─ attendance.ts            # AttendanceStatus, Member, AttendanceCounts, deriveAttendanceCounts()
├─ feedback.ts              # FeedbackNote, feedbackDigest()
├─ briefing-content.ts      # EvidenceItem, BriefingContent, BriefingTextEdits, TEXT_LIMITS
├─ briefing-rules.ts        # normalizeSourceIds(), validateEvidenceSections(sections, inputFeedbackIds)
├─ generated-sections.ts    # buildGeneratedSectionsSchema(feedbackIds): per-request strict schema with z.enum(ids)
├─ freshness.ts             # computeFreshness(snapshot, currentMembers, currentFeedback)
├─ api/                     # event-view.ts · attendance-api.ts · briefing-api.ts · generation-api.ts · errors.ts
└─ gateway-rpc/             # subpath export: briefing-generate-v1.ts · gateway-error-codes.ts
```

### Evidence rules

**Terminology.** In these specs a *source* is one feedback note (F01–F08), identified by its ID. All notes come from the same anonymous feedback form, so there is only one *kind* of source. "Two sources" therefore means **two different notes**, not a second dataset.

| Section | Minimum distinct notes cited | Reason |
| --- | --- | --- |
| Feedback summary (one item) | 1 | Answers the feedback side of *what happened*; reported experience, never counts (D16) |
| Theme | 2 | A recurring pattern must appear in more than one note (F4 theme definition) |
| Conflict | 2 | A disagreement exists *between* notes, so the note for each opposing view must be inspectable |
| Suggestion | 1 | One note can justify a tentative follow-up |

All sections allow at most 8 distinct notes per item and 10 items per section. Item text is 1–1,000 characters after trimming; the feedback summary is 1–600; the overview is 1–500.

**Why a conflict needs two notes.** The supplied conflicts are F03 *"Could we start earlier next time?"* against F04 *"An earlier start would be difficult for me."*, and F01 (meeting point hard to find) against F02 (no trouble finding the group). Each side of the disagreement is written in a **different** note. If one cited note were enough, the model could return "Views differ on the start time" citing only F03. That passes validation, but the coordinator can open only the request and never sees the objection, which is the "erase the opposing view" failure the brief forbids. A single note cannot conflict with itself: F01 ("enjoyable, but the meeting point was difficult to find") is a mixed view within one note, not a disagreement.

**Consequence of anonymity.** The notes are not linked to the roster and carry no identity. A conflict is therefore a difference **between notes**, not between people:

- Two notes might have been written by the same person, and nothing says the writers attended.
- Conflict text must say "one note asks…, another note says…" or "feedback differs on…".
- It must never say "members disagree", "some attendees", "half the group" or give a head count.

This wording rule is added to the prompt and to the human-review checklist. The two-note minimum is structural; whether the text represents each note faithfully remains a human review step.

## 5. API surface

| Method and path | Body | Success |
| --- | --- | --- |
| `GET /api/health` | — | `200 { mysql: "up", redis: "up" \| "down" }` |
| `GET /api/events/E101` | — | `200 EventView` (cached, §7; browser `Cache-Control: no-store`) |
| `PUT /api/events/E101/attendance` | `{ baseAttendanceRevision, members: [{ id, attendance }] }` | `200 { members, counts, attendanceRevision, freshness }` |
| `POST /api/events/E101/briefing-generations` | `{ baseAttendanceRevision }` | `201 { incomingPreview }`, **synchronous**. Used by both **Generate** and **Retry** |
| `POST /api/events/E101/feedback` | `{ submissionId, text }` | `201 { note, automaticBriefing: "scheduled" \| "deferred" }`; `200` for a repeated `submissionId` |
| `GET /api/events/E101/changes` | — | `text/event-stream`: `changed` messages carrying the view version |
| `POST /api/events/E101/briefing-preview/select` | `{ generationId, expectedSelectedGenerationId }` | `200 { selectedPreview }` |
| `PUT /api/events/E101/briefing` | `{ baseBriefingRevision, generationId, textEdits }` | `200 { savedBriefing, briefingRevision, selectedPreview }` |
| `GET /api/docs` (optional) | — | OpenAPI document generated from the same Zod contracts |

```ts
type GenerationProvenance = {
  generationId: GenerationId; jobId: JobId; generatedAt: string; model: string; promptVersion: string;
  input: { attendance: { memberId: MemberId; attendance: AttendanceStatus }[]; counts: AttendanceCounts;
           feedbackIds: FeedbackId[]; feedbackDigest: string };
};
type BriefingView = {
  provenance: GenerationProvenance; content: BriefingContent; savedAt?: string;
  freshness: { current: boolean;
               attendanceChanges: { memberId: MemberId; from: AttendanceStatus; to: AttendanceStatus }[];
               newFeedbackIds: FeedbackId[] };
  trigger: "manual" | "feedback_batch";
};
type GenerationStatusView = {
  manual: { runId: RunId; startedAt: string } | null;                        // coordinator generation in flight
  batch: {
    state: "collecting" | "waiting" | "generating" | "retry_wait";
    jobId: RunId; closesAt?: string; nextAttemptAt?: string; attempt?: number; newNoteIds: FeedbackId[];
  } | null;
  lastOutcome: { runId: RunId; trigger: "manual" | "feedback_batch";
                 status: "succeeded" | "failed" | "skipped" | "superseded" | "superseded_by_manual";
                 code?: ErrorCode; finishedAt: string } | null;
  cooldownUntil: string | null;
};
type EventView = {
  event: EventSummary; members: Member[]; feedback: FeedbackNote[]; counts: AttendanceCounts;
  attendanceRevision: number; briefingRevision: number;
  savedBriefing: BriefingView | null; selectedPreview: BriefingView | null; incomingPreview: BriefingView | null;
  generation: GenerationStatusView;
};
```

| Group | Error codes |
| --- | --- |
| 400 | `VALIDATION_FAILED` (fails the Zod request schema) |
| 403 | `ORIGIN_REJECTED` |
| 404 | `EVENT_NOT_FOUND`, `NOT_FOUND` (unknown API route) |
| 409 | `ATTENDANCE_CONFLICT`, `BRIEFING_CONFLICT`, `PREVIEW_CONFLICT`, `GENERATION_NOT_AVAILABLE` |
| 422 | `CONTENT_INVALID`, `REFERENCE_INVALID` (well-formed but contradicts server state) |
| 422 (feedback) | `FEEDBACK_LIMIT_REACHED` |
| 429 | `PROVIDER_COOLDOWN` (with `retryAfterMs`), `DAILY_LIMIT_REACHED` |
| 502 / 503 / 504 (manual generation) | `OUTPUT_INVALID`, `OUTPUT_INCOMPLETE`, `PROVIDER_REFUSED` / `GATEWAY_UNAVAILABLE`, `PROVIDER_NOT_CONFIGURED` / `AI_OUTCOME_UNKNOWN`, `DEADLINE_EXCEEDED` |
| 500 / 503 | `STORE_UNAVAILABLE`, `STORE_CORRUPT`, `QUEUE_UNAVAILABLE`, `INTERNAL` |
| Batch outcome | the generation codes above plus `GATEWAY_AUTH_FAILED`, `PROVIDER_RATE_LIMITED`, `PROVIDER_TEMPORARY`, `ATTEMPTS_EXHAUSTED`, `RESULT_PERSIST_FAILED`, `DAILY_LIMIT_REACHED` |

## 6. Persistence — MySQL 8.4 + TypeORM

Tables, relations, constraints and every transaction boundary are specified in **[T4 — Data model, relations and transactions](13-data-model-and-transactions.md)**. In short:

- **Event aggregate.** `events`, `members` and `feedback_notes`, with no relation between notes and members.
- **Immutable generations.** Input snapshots, items and item sources. A composite FK makes the database reject a citation of any note that was not in that generation's input.
- **Saved briefing.** Stores human text per generated item and **no references of its own**, so text-only editing (D2) is enforced by the schema.
- **Outcome rows.** One per finished job, for the UI.
- **Transactions.** Every write is one InnoDB transaction holding the event row lock. Redis side effects run after commit through `afterCommit`.

### Freshness (D5, confirmed)

```text
attendanceChanges = members whose current saved status ≠ status in generation_attendance_inputs
feedbackChanged   = feedbackDigest(current notes) ≠ generation.feedback_digest
current           = attendanceChanges is empty AND NOT feedbackChanged
```

- A warning appears only when the data really differs, and it names the change ("Chris: Not recorded → Attended").
- A swap (Alex ↔ Bea) produces two changes, even though the counts are equal.
- An exact revert produces no changes, because the briefing matches the records again.
- No revision bookkeeping is involved; the revision counters remain purely for write conflicts.

## 7. Response cache (A4)

The cache covers one endpoint, `GET /api/events/:eventId`, and every write flushes it. A bare `DEL` has a race:

1. A reader misses the cache and reads old rows.
2. A writer commits and deletes the key.
3. The reader writes the old rows back into the cache.

The version number in the key closes that window:

| Step | Action |
| --- | --- |
| Keys | `event-desk:cache:event:{id}:ver` (integer) and `event-desk:cache:event:{id}:v{ver}` (JSON EventView) |
| Read | `GET ver` → `GET v{ver}`. On a miss, build the view (T4 TX2 + queue status), then `SET v{ver} … PX ttl` using the version read *before* the database read. |
| Flush | After every commit or queue-state change: `INCR ver`, then `DEL v{old}`. A late `SET` lands on the retired version, which nothing reads again. |
| TTL | Default 30 s, capped at the next time-driven state change (batch `closesAt`, `nextAttemptAt`, `cooldownUntil`) |
| Flush triggers | Attendance save, feedback submitted, preview select, briefing save, manual generation start/finish, batch scheduled/started/retry-wait/finished, reset. Every flush also emits SSE `changed` (A16). |
| Failure safety | Redis down → read MySQL. Flush failed → in-process `cacheBypass` until a flush succeeds. |

MySQL stays authoritative. Freshness is computed while the view is built, so the cache never decides it.

## 8. Generation — manual path and batch queue

Behaviour is in [F4](04-ai-briefing-generation.md#generation-flow) (manual) and [F7](07-generation-queue.md) (batch). The implementation is in **[T5](14-generation-queue-implementation.md)**.

- **Manual:** `POST /briefing-generations` → `ManualGenerationCoordinator` (single-flight) → `BriefingGenerationService` → Gateway `interactive` lane → commit → `201`. No queue.
- **Batch:** feedback commit → BullMQ job with throttle de-duplication (`ttl` = window) and `delay` = window → worker (concurrency 1) → same `BriefingGenerationService` with the "nothing new" check → Gateway `background` lane → commit.
- **Shared:** one generation service, one Gateway client, one validation path. The incoming-slot rules give the manual result priority.

## 9. AI Gateway

```text
apps/ai-gateway/src/
├─ main.ts                      # process: config, listen, graceful shutdown
├─ compose.ts                   # composition root: wires model, limits, operation and transport by hand
├─ config/env.ts                # Zod env schema; fail fast; copies only its own keys from .env
├─ transport/rpc-server.ts      # tcp-rpc server: contract validation, op routing, safe error envelopes, reply self-check
├─ operations/
│  ├─ briefing-model.ts         # BriefingModel port (one provider request per call)
│  └─ briefing-generate-v1.ts   # deadline ceiling → lane → backstop → model → evidence check
├─ ai/                          # the only folder that imports openai / @openai/agents-*
│  ├─ openai-client.ts          # new OpenAI({ maxRetries: 0, timeout, fixed baseURL, logLevel: "off" })
│  ├─ briefing-prompt.ts        # PROMPT_VERSION, developer instructions (F4 + §4 wording rules), user-data message
│  ├─ openai-briefing-model.ts  # the BriefingModel adapter: Runner with an injected OpenAIProvider client,
│  │                            # setTracingDisabled(true), outputType = buildGeneratedSectionsSchema(ids)
│  └─ provider-error-mapper.ts  # SDK/provider errors → gateway codes, notSent, retryAfterMs
└─ limits/lane-gate.ts · limits/usage-backstop.ts
```

Concurrency: one in-flight call per lane (`interactive`, `background`).

Agents SDK settings, verified against the installed version and covered by tests:

- `modelSettings: { store: false, maxTokens: 4000, retry: { maxRetries: 0 } }`, plus `reasoning.effort` when configured
- `run(agent, input, { maxTurns: 1, signal })`; the signal aborts the provider call `GATEWAY_RESPONSE_MARGIN_MS` before the deadline
- no tools and no handoffs
- tracing disabled globally (`setTracingDisabled(true)`) and per run (`tracingDisabled: true`)
- client `maxRetries: 0`, fixed `baseURL`, SDK logging off
- a failure with `notSent: false` (any code, including `DEADLINE_EXCEEDED`) means the provider may have received and billed the request: callers confirm before Retry and never replay it

TCP protocol (`packages/tcp-rpc`):

- **Framing.** Each frame is a `uint32 BE` length followed by UTF-8 JSON. The length is checked before buffering (64 KiB request, 128 KiB response). A streaming decoder handles fragmented and combined chunks.
- **One connection per attempt.** Connect with a 2 s timeout, send one request, read one response, close.
- **Error classification.** A refused connection or connect timeout means `notSent: true`. A socket that closes after the request was written, or a passed deadline, means `AI_OUTCOME_UNKNOWN`.
- **Envelope.** `{ v: 1, auth, requestId, operation, runId, attemptId, lane, deadlineAt, input }` ([F8](09-ai-gateway.md#tcp-operation)). The server compares `auth` with `timingSafeEqual` over SHA-256 digests and strips it before the handler runs.
- **Binding.** Loopback only.

## 10. Engineering principles (showcase quality)

| Principle | Concrete practice |
| --- | --- |
| **Contract-first** | One Zod schema per boundary in `packages/contracts`. Types are inferred from it, it validates at runtime at every edge (HTTP body, TCP frame, DB row, LLM output, env vars), and it is optionally published as OpenAPI. There are no hand-written duplicate DTOs. |
| **Layered + ports and adapters** | Controllers → application services → ports (`UnitOfWork`, `BriefingBatchQueue`, `AiGatewayClient`, `EventViewCache`, `ChangeNotifier`, `Clock`, `IdGenerator`) → adapters (TypeORM, BullMQ, tcp-rpc, Redis, SSE). Services can be tested with in-memory fakes, and the queue could be swapped (BullMQ → Temporal) without touching services. |
| **Functional core, imperative shell** | Domain decisions are pure functions in `domain/` folders or `contracts`: counts, diff, freshness, evidence validation, text-edit application, retry policy and window decisions. I/O lives only in adapters. |
| **Explicit composition root** | `main.ts` wires the dependencies by hand. No DI container or decorators, so the dependency graph is readable in one file. |
| **Typed errors** | An `AppError` with an `ErrorCode` from contracts; one Express error middleware maps codes to HTTP status; exhaustive `switch` checks with a `never` guard. No string throws, no `any`. |
| **Branded IDs** | `MemberId`, `FeedbackId`, `GenerationId` and `JobId` cannot be mixed up at compile time |
| **Transactions as structure** | The `UnitOfWork.run()` + `afterCommit()` pattern ([T4 §5](13-data-model-and-transactions.md#7-code-shape)), so services cannot forget the commit-then-side-effect order |
| **Architecture tests** | dependency-cruiser rules run in CI: layer direction; `typeorm` only in persistence/repositories; `bullmq`/`ioredis` only in integrations; `openai` only in ai-gateway; `web` cannot import Node packages |
| **Observability** | pino JSON logs with redaction. Correlation runs from `requestId` (HTTP) to `jobId` (queue) to `rpcRequestId` (Gateway). `/api/health`. No raw notes or model output in logs (S1). |
| **Graceful shutdown** | On SIGTERM: stop HTTP, `worker.close()` (waits for the active job up to a limit), close Redis and MySQL. The Gateway stops accepting connections and finishes its in-flight call or aborts it at the deadline. |
| **Configuration** | Zod-validated env per app; invalid config exits with a clear message. Secrets only come from env and never reach logs or the browser. |
| **Decisions recorded** | One ADR per confirmed decision in `docs/adr/` (context, options, decision, consequences) |
| **Frontend quality** | Feature folders; a data layer separated from the UI; accessible controls (labels, focus, `aria-expanded`, live regions); an error boundary per panel; no server state copied into Zustand |

## 11. Layered architecture

### event-api

```text
apps/event-api/src/
├─ main.ts                        # composition root
├─ app.ts                         # createApp(deps) for Supertest
├─ config/env.ts
├─ http/
│  ├─ middleware/                 # origin-guard.ts · require-json.ts · request-id.ts · error-handler.ts
│  ├─ validate-body.ts
│  └─ routes.ts
├─ modules/
│  ├─ event/        event-controller.ts · event-view-service.ts
│  ├─ attendance/   attendance-controller.ts · attendance-service.ts · domain/diff-attendance.ts
│  ├─ briefing/     briefing-controller.ts · briefing-service.ts · domain/apply-text-edits.ts · domain/attendance-overview.ts
│  ├─ feedback/     feedback-controller.ts · feedback-service.ts (submit, idempotency, limits)
│  ├─ changes/      changes-controller.ts (SSE) · change-notifier.ts
│  └─ generation/   generation-controller.ts · manual-generation-coordinator.ts · briefing-generation-service.ts
│                   · batch-generation-processor.ts · batch-reconciler.ts
│                   · domain/incoming-slot-rules.ts · domain/retry-policy.ts · domain/input-equality.ts
├─ ports/                         # unit-of-work.ts · briefing-batch-queue.ts · ai-gateway-client.ts · event-view-cache.ts · change-notifier.ts · clock.ts
├─ repositories/                  # TypeORM implementations of the repository/UnitOfWork ports
├─ persistence/                   # data-source.ts · entities/*.ts (EntitySchema) · migrations/ · seed-data.ts · seed.ts
├─ integrations/                  # bullmq-briefing-batch-queue.ts · redis-event-view-cache.ts · tcp-ai-gateway-client.ts
├─ scripts/                       # reset.ts · simulate-feedback.ts (pnpm feedback:simulate)
└─ shared/                        # app-error.ts · async-mutex.ts · logger.ts
```

Direction: `http → controllers → services → ports ← repositories/integrations → persistence/infrastructure`. Services import ports, never adapters.

### web

```text
apps/web/src/
├─ main.tsx · app.tsx              # QueryClientProvider (MutationCache toast policy), Astryx providers / LayerProvider
├─ routes.tsx                      # /events/:eventId (coordinator) · /events/:eventId/feedback (test feedback form)
├─ config.ts                       # EVENT_ID, POLL_INTERVAL_MS
├─ data/                           # DATA LAYER — no components
│  ├─ http/api-client.ts           # axios instance; errors normalised to ApiError; no toasts, no retries
│  ├─ api/event-api.ts             # typed endpoint functions (contracts)
│  ├─ queries/                     # use-event-query.ts · query-keys.ts
│  ├─ stream/use-event-changes.ts  # EventSource → invalidate event query; polling fallback
│  └─ mutations/                   # use-save-attendance.ts · use-generate-briefing.ts · use-select-preview.ts
│                                  # · use-save-briefing.ts · use-submit-feedback.ts
├─ state/ui-store.ts               # Zustand: cross-panel UI state only
├─ features/                       # UI LAYER
│  ├─ event/        event-page.tsx · event-header.tsx
│  ├─ attendance/   attendance-panel.tsx · use-attendance-autosave.ts
│  ├─ feedback/     feedback-panel.tsx · source-reference.tsx
│  ├─ briefing/     briefing-panel.tsx · briefing-editor.tsx · use-briefing-form.ts · generation-status.tsx
│  │                · batch-status.tsx · freshness-notice.tsx · incoming-preview-notice.tsx
│  └─ feedback-form/ feedback-form-page.tsx (separate route; anonymous text area + Submit)
└─ shared/          ui/ (status-message.tsx, confirm-dialog.tsx, panel-error-boundary.tsx) · hooks/
```

| State | Owner |
| --- | --- |
| Event aggregate, job status, slots | React Query `["event", EVENT_ID]` |
| Attendance change in flight | `use-attendance-autosave` (local state; no draft: each change saves at once, amended 2026-10-04). A newer saved view replaces what is shown whenever no save or check is in flight |
| Briefing text draft | React Hook Form keyed by `slot + generationId + briefingRevision`. Reset only on explicit select, save or discard. |
| `attendanceDirty`, `briefingDirty`, active view, open source disclosures | Zustand |
| Already-announced job outcomes | `sessionStorage`, once per `jobId` |

Generate and Retry both use `use-generate-briefing` (a synchronous mutation; the button shows **Generating…**, and is not offered while the briefing is being edited). Retry shows a confirmation dialog first when the code is `AI_OUTCOME_UNKNOWN`. On success the result is auto-selected if the briefing form is clean. Batch progress comes from `generation.batch` in the event query, kept current by the change stream.

## 12. Testing

| Layer | Tooling | Covers |
| --- | --- | --- |
| contracts | Vitest | counts, evidence rules (incl. conflict ≥ 2 notes), freshness (swap, revert), schema factory |
| event-api domain | Vitest | diff, text edits, overview, retry policy, window decisions (fake clock) |
| event-api integration | Vitest + Supertest against Compose MySQL/Redis (`event_desk_test`, Redis DB 1), fake Gateway with controllable latency | F1–F7 (incl. 5 notes → 1 call, manual priority, single-flight), T4-01…09, cache flush race, SSE, restart, reset |
| tcp-rpc | Vitest | fragmented/combined frames, oversize, auth, unknown-outcome classification |
| ai-gateway | Vitest with stubbed `run` | prompt separation and wording rules, SDK settings, error mapping, output validation |
| web | Vitest + Testing Library + MSW | dirty-state preservation under refetch, toast once, Retry flow, keyboard access |
| E2E | Playwright with all apps + fake Gateway | the F6 coordinator walkthrough |
| Architecture | dependency-cruiser | layer and provider-boundary rules |
| Live | `pnpm smoke:live` (manual, real key) | F4-01/F4-11 live-model evidence; never in CI |

## 13. Local runtime and CI

| Compose service | Image | Config |
| --- | --- | --- |
| `mysql` | `mysql:8.4` | databases `event_desk` and `event_desk_test`; app user; `127.0.0.1:3306`; named volume; health check |
| `redis` | `redis:8` | `--appendonly yes --appendfsync always --maxmemory-policy noeviction`; `127.0.0.1:6379`; named volume; health check |

```text
pnpm install
docker compose up -d
pnpm dev                                         # ai-gateway, event-api, web (local Node)
pnpm feedback:simulate --count 5 --interval-ms 200   # burst of notes → one automatic briefing
pnpm --filter @event-desk/event-api db:reset     # apps stopped
```

Reset refuses to run while `/api/health` answers. It drops and recreates only `event_desk`, removes all added notes, deletes only the `bull:briefing-batch:*` and `event-desk:*` keys (SCAN + DEL), and reports what it removed. The next start migrates and reseeds.

| Variable | App | Default |
| --- | --- | --- |
| `HOST`, `PORT` | event-api | `127.0.0.1`, `4000` |
| `MYSQL_URL` | event-api | `mysql://event_desk:…@127.0.0.1:3306/event_desk` |
| `REDIS_URL` | event-api | `redis://127.0.0.1:6379/0` |
| `ALLOWED_ORIGINS` | event-api | `http://localhost:5173` |
| `EVENT_VIEW_CACHE_TTL_MS` | event-api | `30000` |
| `MYSQL_QUERY_TIMEOUT_MS` | event-api | `5000` (also bounds row-lock waits and pool acquisition) |
| `BRIEFING_BATCH_WINDOW_MS` | event-api | `3000` |
| `BATCH_MAX_ATTEMPTS`, `MANUAL_GENERATION_TIMEOUT_MS` | event-api | `3`, `60000` |
| `GENERATION_DAILY_ATTEMPT_LIMIT`, `GENERATION_BATCH_DAILY_LIMIT` | event-api | `20`, `15` |
| `FEEDBACK_SUBMISSION_ENABLED`, `FEEDBACK_MAX_NOTES_PER_EVENT` | event-api | `true`, `100` |
| `GATEWAY_HOST`, `GATEWAY_PORT`, `GATEWAY_SERVICE_SECRET` | both | `127.0.0.1`, `4100`, required (≥ 32 bytes) |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` | ai-gateway only | unset (Gateway answers `PROVIDER_NOT_CONFIGURED`); `gpt-5-mini`; `low` |
| `OPENAI_TIMEOUT_MS`, `MAX_OUTPUT_TOKENS` | ai-gateway only | `50000`, `4000` |
| `GATEWAY_MAX_CALL_MS`, `GATEWAY_RESPONSE_MARGIN_MS`, `GATEWAY_DAILY_CALL_LIMIT` | ai-gateway only | `60000`, `1000`, `40` (in-memory backstop; the event API owns the real budget) |

CI (GitHub Actions) runs install with the pnpm cache, then lint, typecheck, dependency-cruiser, unit tests, integration tests (MySQL and Redis service containers) and Playwright. The live model is never called in CI.

## 14. Known limits

- Manual single-flight, the SSE notifier and the cache-bypass flag assume one event-api process. Scaling out would require Redis-based locks and pub/sub.
- A manual generation holds an HTTP request open for up to `MANUAL_GENERATION_TIMEOUT_MS`; that is acceptable for one coordinator, but not a pattern for high traffic.
- The feedback form and script are test channels beyond the brief. The supplied F01–F08 stay unchanged, and reset removes additions.
- Correlation IDs prevent wrong commits, not double billing. Retrying after `AI_OUTCOME_UNKNOWN` may be charged twice, which is why the UI asks for confirmation.
- Evidence checks are structural. Two valid notes on a conflict do not prove each side is described faithfully.

## 15. Build order

1. Scaffold the workspace, `AGENTS.md`, contracts, Compose, CI skeleton and ADRs. Spikes: BullMQ ([T5 §6](14-generation-queue-implementation.md#6-spike-first-build-step)) and Astryx/StyleX with Vite.
2. Migrations and the T4 schema; F1 seed/load/reset; F2 attendance; F3 feedback panel; event-view cache. End to end with tests.
3. tcp-rpc + ai-gateway + a live smoke call; synchronous manual generation into the incoming slot.
4. F5 select/edit/save and F6 freshness, then the F6 walkthrough in Playwright.
5. Feedback form + script, BullMQ batching, change stream, manual priority, retries/cooldown/unknown outcome/budget, and the S1 cases.
6. Hand-in README: commands, env, trade-offs, validation limits, reused boilerplate.
