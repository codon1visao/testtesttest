# AI Community Club Event Desk — specification index

Status: **Confirmed by the user on 2026-10-03 — approved for implementation planning.** All decisions D1–D16 are confirmed. Exact package versions and the OpenAI model are pinned during implementation as configuration, not open design questions. Architecture, data model and generation implementation are in [T3](12-architecture-and-repository.md), [T4](13-data-model-and-transactions.md) and [T5](14-generation-queue-implementation.md).

Implementation: Plans 1–5 (docs/superpowers/plans) are complete and merged (2026-10-04); the hand-in README at the repository root explains how to run, reset and evaluate the build.

Source: [project brief](../project-brief.md). The brief is authoritative. This breakdown makes its requirements testable and records the confirmed design decisions that go beyond it.

Frontend choices are confirmed in [T1](10-frontend-technologies.md); backend choices and shared conventions are in [T2](11-backend-technologies.md). Architecture, repository layout, engineering principles and cache design are in [T3](12-architecture-and-repository.md); entities, relations and transaction boundaries in [T4](13-data-model-and-transactions.md); the queue implementation in [T5](14-generation-queue-implementation.md). Everything lives in one root pnpm workspace: `apps/web`, `apps/event-api`, `apps/ai-gateway`, `packages/contracts` and `packages/tcp-rpc`; Docker Compose runs only MySQL and Redis.

## Product goal: solve the client situation

The goal is to give Harbour Community Club's coordinator **a reliable attendance record and a useful briefing that explains what happened, which themes recur, where people disagree and what might be worth following up**. This comes directly from [The client situation](../project-brief.md#the-client-situation).

For the supplied ended Saturday Walk, the coordinator should be able to maintain the attendance record and turn the separate short feedback notes into a concise, evidence-backed account they can review, correct and rely on. The attendance controls, AI call, editor and persistence support that job. Completing those controls alone does not establish that the client problem is solved.

### What success means for the coordinator

| Client need | Evidence that the product meets it | Supporting features |
| --- | --- | --- |
| A reliable attendance record | Member statuses and totals agree, Not recorded remains distinct from Absent, and saved corrections survive refresh/restart. Feedback never determines attendance. | F1, F2 |
| Understand what happened | The briefing identifies the ended event and gives a concise account grounded in saved attendance and reported feedback. It separates roster facts from opinions and does not invent event details or reasons for absence. | F2, F3, F4 |
| See which themes recur | Meaningful patterns across multiple notes are synthesised into themes with their sources, following the [theme definition](04-ai-briefing-generation.md#theme-terminology). F05/F06 together show a repeated request for more rest time; F07 alone is a single route-length suggestion, not a theme. Repetition across notes is not treated as a count of distinct people or consensus. | F3, F4 |
| See where people disagree | Both the meeting-point experiences (F01/F02) and start-time preferences (F03/F04) remain visible with inspectable evidence. A neat summary must not erase disagreement. | F3, F4 |
| Know what might be worth following up | Suggested next steps respond to the notes and their conflicts, remain tentative and cite their sources. For example, explore start-time constraints rather than declare an earlier start agreed. | F4, F5 |
| Rely on the briefing after review and corrections | The coordinator can inspect sources, edit text and save it with its original references. Attendance corrections flag older content as out of date, while regeneration preserves saved human work until explicit replacement. | F1, F5, F6 |

Evaluate the completed product by this coordinator task: save accurate attendance, obtain a concise briefing answering the four questions above, inspect its evidence, correct wording, save it and revisit it after an attendance correction. The workflow and technical checks below support this evaluation; a successful model response or save request alone is insufficient.

## Feature specifications

| ID | Feature | Owns | Depends on |
| --- | --- | --- | --- |
| F1 | [Event, initial data and persistence](01-event-and-persistence.md) | Event loading, seed-once behaviour, durable storage and explicit reset | None |
| F2 | [Attendance recording and counts](02-attendance.md) | Attendance editing, validation, saving and deterministic counts | F1 |
| F3 | [Feedback and source inspection](03-feedback-and-sources.md) | Read-only notes, stable IDs and opening cited evidence | F1 |
| F4 | [AI briefing generation](04-ai-briefing-generation.md) | Backend model call, prompt, structured output and validation | F2, F3 |
| F5 | [Briefing editing and saving](05-briefing-editor.md) | Text-only editing, preserved references, validation and explicit save | F3, F4 |
| F6 | [Freshness and safe regeneration](06-freshness-and-regeneration.md) | Staleness, attendance snapshots and protection from replacement | F2, F4, F5 |
| F7 | [Automatic briefing generation from feedback batches](07-generation-queue.md) | Fixed-window batching of new notes, coordinator priority, incoming-slot rules, batch status in the UI | F1, F3, F4, F5, F6 |
| S1 | [Secure OpenAI generation](08-openai-security.md) | Untrusted feedback, prompt injection, credentials, privacy, output and cost controls | F3, F4, F7 |
| F8 | [Internal AI Gateway over TCP](09-ai-gateway.md) | Sole provider-call boundary, Gateway credentials/profile, typed TCP contract and service failure handling | F4, F7, S1 |
| T1 | [Frontend technologies and conventions](10-frontend-technologies.md) | Selected libraries, data/UI layers, state ownership, mutation toasts and naming | F1–F7 |
| T2 | [Backend technologies and shared conventions](11-backend-technologies.md) | Express, MySQL/TypeORM, Redis caching, Agents SDK, pnpm layout and repository layer | F1, F7, F8, S1 |
| T3 | [Architecture and repository layout](12-architecture-and-repository.md) | Workspace layout, layers and ports, engineering principles, cache flush, TCP protocol, testing, local runtime | T1, T2, F1–F8, S1 |
| T4 | [Data model, relations and transactions](13-data-model-and-transactions.md) | MySQL tables, relations, DB-enforced evidence constraints, transaction boundaries, unit of work | F1–F7, T3 |
| T5 | [Generation queue implementation](14-generation-queue-implementation.md) | BullMQ mapping of F7, admission, in-job retries, crash recovery, spike, alternatives | F7, F8, T3, T4 |

F1–F8 are specification identifiers; F01–F08 are the supplied feedback source IDs (added notes continue as F09, F10, …). F1–F6 cover the original assignment; F7, F8 and S1 record the user's batching, internal Gateway and security requirements. Existing notes are never edited; new notes can be added only through the test feedback form or script ([F3](03-feedback-and-sources.md#adding-feedback-test-extension)), an extension beyond the brief. All notes are always treated as untrusted user input. Dependencies describe relationships, not reduced scope.

## Coordinator flow mapped to the brief's outcomes

The [What the coordinator should be able to do](../project-brief.md#what-the-coordinator-should-be-able-to-do) table defines the workflow that serves the client goal above. The outcomes describe capabilities needed to obtain and maintain a useful, trustworthy briefing.

| Outcome from the brief | Coordinator flow and resulting state | Specifications |
| --- | --- | --- |
| Record attendance | Open the seeded event, change member attendance, see recalculated counts labelled unsaved, then save through the backend. Refresh/restart restores the saved records. | F1, F2 |
| Review feedback | Read each supplied note and its stable ID. Notes remain read-only and separate from the roster. | F3 |
| Generate an AI briefing | Press Generate: the event API calls the AI Gateway over TCP synchronously (no queue) and returns the candidate, which opens for review when the editor is clean. New feedback (form/script) is batched: one automatic generation per fixed 3-second window, reading all notes at run time, with its progress shown in the briefing panel. The coordinator's generation always takes priority. Show what happened (attendance overview + feedback summary), themes, conflicts and suggestions with inspectable sources. | F3, F4, F7, F8 |
| Inspect and edit | Open referenced notes, edit only the generated wording, then Save. Keep the generated section/item structure and reference associations unchanged; persist wording and references together. The saved briefing can subsequently be reopened for text edits. | F3, F5 |
| Keep work trustworthy | After a saved attendance change, mark the existing saved briefing, preview and open editor out of date without changing their text or references. Regeneration is explicit and produces a separate preview; only an explicit Save of that preview replaces saved human work. Display loading and failures without losing edits. | F2, F4, F5, F6 |

Text editing begins with a generated briefing, not a blank document. An attendance save does not automatically regenerate, refresh the overview wording or discard the editor draft. Editing or saving an old briefing never clears its out-of-date flag. [F6](06-freshness-and-regeneration.md#example-edit-save-change-attendance-regenerate) walks through this sequence with the supplied records.

## Required by the brief

- React/TypeScript frontend and Node.js/TypeScript backend with a simple persistent store.
- One ended event, its four registered members and eight supplied feedback notes.
- Three distinct attendance states; counts calculated in application code from saved records.
- A real backend model call producing themes, conflicts, follow-ups and a cited feedback summary, combined with a code-built attendance overview to answer what happened.
- Feedback references for every generated theme, conflict and suggestion; inspectable notes and validation of their IDs.
- Human editing of the generated briefing, with durable saving of wording and references. D2 limits editing to text; references remain unchanged.
- An out-of-date indication after attendance changes, and protection against regeneration overwriting human edits.
- Clear loading, generation and save failure states; documented seeding, reset, trade-offs, validation limits and any reused boilerplate.

## Shared design

Confirmed decisions are listed below, including the AI Gateway boundary. Design details in this section are confirmed design decisions, not additional requirements from the original brief.

### Screen and interaction

Use one event page with the event title and ended status, an attendance panel, a feedback panel and a briefing panel. Keep attendance Save separate from briefing Save. Recalculate displayed attendance counts as selections change and label them as unsaved; retain saved counts as the factual baseline used for generation.

The briefing panel presents content under the brief's four questions, with short section headings (Summary · Themes · Disagreements · Suggestions for you; amended 2026-10-04, user-approved), and shows saved content or a selected generated preview/editor, alongside generation status and a New briefing ready notice when an incoming candidate exists. Its header holds the actions: Edit and Generate in the read view, Cancel and Save while editing. Automatic completion never changes the active editor. The coordinator selects a candidate for text editing and later saves it explicitly; source references remain inspectable and read-only. Activating a briefing item reveals the notes it cites, with their IDs, inline below the item, avoiding a separate navigation flow.

Every mutation action shows a success/error toast under [T1](10-frontend-technologies.md#mutation-feedback). Generate's success toast means the briefing was generated; automatic batch results are announced once when ready.

At narrow widths, stack panels in reading order: event, attendance, feedback, briefing. Controls have visible labels, keyboard access and visible focus. Communicate errors, progress, unsaved changes and staleness in text, not colour alone. Announce save/generation outcomes without unexpectedly moving focus. Detailed visual styling is outside this specification.

### Data ownership and minimum model

**Scope distinction:** the brief requires current attendance records to be editable and persistent, and a briefing to be marked out of date when attendance changes. It does not require attendance revisions, attendance history or an audit log. The revision counters below are confirmed (2026-10-03) as internal optimistic-concurrency tokens for conflicting saves only; they are not coordinator-facing features and do not decide freshness. They store counters, not historical copies of attendance.

| Record / field | Meaning and owner |
| --- | --- |
| `event` | Seeded `id`, `name`, `clubName`, `status: "ended"`; read-only |
| `members[]` | Seeded `id`, `name` and editable `attendance`: `attended`, `absent`, `not_recorded` |
| `feedback[]` | The eight seeded notes plus any notes added through the test form/script; insert-only, read-only in the coordinator panel, untrusted as model input and unrelated to members |
| `attendanceRevision` | Internal write-conflict counter; advances on a save that changes a status; not an attendance-history record |
| `counts` | Derived `{ registered, attended, absent, notRecorded }`; never independently editable or model-owned |
| `savedBriefing` | At most one durable human-approved briefing with a backend `savedAt` timestamp, or `null` |
| `selectedPreview` | One selected, durable generated candidate, or `null`; stable base for the text editor |
| `incomingPreview` | Latest completed candidate waiting for explicit selection; worker may replace only this unedited slot |
| Batch jobs | BullMQ jobs for feedback batches (fixed window, one running at a time) plus durable outcome rows in MySQL; manual generation is synchronous and has no job; no queue dashboard or audit history |
| `briefingRevision` | Internal save-conflict counter |
| Generation provenance | Server-owned generation/job ID, time, model, prompt version and input snapshot (per-member attendance, counts, feedback IDs and digest); freshness compares this snapshot with current saved data |
| Briefing content | `attendanceOverview` (code-built fact), `feedbackSummary` (reported, cited), `themes[]`, `conflicts[]`, `suggestions[]` using the shape below |

There is one saved briefing, one selected generated preview and at most one incoming candidate. This bounded set protects the edit base during background work without full version history. Persisted inputs/results bind editing to backend-owned provenance. Unsaved human edits live only in the browser; saved work has the durability guarantee.

The model receives counts and feedback IDs/text. Member names are unnecessary for briefing generation. Neither the model nor feedback can mutate attendance. The frontend cannot change provenance fields or claim that an old generation used the latest attendance.

### Briefing content contract

```ts
type FeedbackId = string; // Runtime-validated against the job's saved feedback IDs; initially F01–F08.
type EvidenceItem = { text: string; sourceIds: FeedbackId[] };
type BriefingContent = {
  attendanceOverview: string;      // What happened: roster fact, built by code from saved records
  feedbackSummary: EvidenceItem;   // What happened: what the notes report overall (reported opinion, cited)
  themes: EvidenceItem[];          // Which themes recur
  conflicts: EvidenceItem[];       // Where people disagree
  suggestions: EvidenceItem[];     // What might be worth following up
};
type BriefingTextEdits = {
  attendanceOverview: string;
  feedbackSummary: string;
  themes: string[];
  conflicts: string[];
  suggestions: string[];
};
```

This is a specification of the shared shape, not code to copy into multiple DTOs or hooks. Reuse one contract during implementation. The shape answers the brief's four questions directly. **What happened** has two parts: the attendance overview (fact, from saved records) and the feedback summary (reported opinion, citing notes). **Which themes recur**, **where people disagree** and **what might be worth following up** map to `themes`, `conflicts` and `suggestions`. The UI gives each question its own section, headed Summary, Themes, Disagreements and Suggestions for you (short names, amended 2026-10-04), so facts, reported opinions and proposed actions stay distinguishable (D16). For this compact build, a conflict item describes both positions and cites their supporting notes; a separate nested argument model is unnecessary.

Although the sections share `EvidenceItem`, their evidence requirements differ: the feedback summary cites at least one note and never restates attendance counts; a theme needs a meaningful grouping supported by at least two distinct feedback IDs; a conflict must cite at least two different notes, the note(s) for each opposing view, and describe the difference as between notes, never between identified or counted people (D12); an individual suggestion may have one supporting note. Runtime validation applies the [section-specific rules](04-ai-briefing-generation.md#backend-validation). There is no target number of themes, and satisfying a reference count does not establish semantic support.

`BriefingContent` is the read/stored shape; `BriefingTextEdits` is the text-only save payload. Each text array has exactly the same length and item positions as the server-owned content for the specified generation. Apply text by section and position; copy references, item structure and provenance from that server record. The coordinator cannot add, remove or reorder items or change their source IDs. Text-only editing does not prove that revised wording is still supported by the fixed sources.

### API contract

Paths and field names below are confirmed; full response types and the error-code list are in [T3](12-architecture-and-repository.md#5-api-surface). Revision fields are confirmed internal concurrency tokens. Each feature owns its endpoint's detailed rules.

| Method and path | Request | Successful response | Owner |
| --- | --- | --- | --- |
| `GET /api/events/E101` | None | `200` event, members, feedback, counts, revisions, saved/selected/incoming briefings, freshness and generation status; served through the Redis cache flushed on every write | F1, F7, T3 |
| `PUT /api/events/E101/attendance` | `{ baseAttendanceRevision, members: [{ id, attendance }] }` containing all four members | `200` persisted members, derived counts, attendance revision and current briefing freshness | F2 |
| `POST /api/events/E101/briefing-generations` | `{ baseAttendanceRevision }`; never prompts or source text. Used by Generate and the Retry button | `201` generated incoming preview (synchronous) | F4 |
| `POST /api/events/E101/feedback` | `{ submissionId, text }` from the test form or script | `201` stored note + batch scheduling status | F3, F7 |
| `GET /api/events/E101/changes` | Server-Sent Events | `changed` notifications so the page refetches | F7, T3 |
| `POST /api/events/E101/briefing-preview/select` | `{ generationId, expectedSelectedGenerationId }` | `200` selected preview; saved briefing unchanged | F7 |
| `PUT /api/events/E101/briefing` | `{ baseBriefingRevision, generationId, textEdits }` | `200` saved briefing with unchanged references, briefing revision and computed freshness | F5 |

Return immediate errors as `{ error: { code, message, field? } }`. Reject malformed requests and unknown write fields; do not accept client counts, event/member edits outside attendance, prompts or provenance overrides. Use `400` for malformed input, `404` for unknown resources, `409` for conflicting saved/selected state, `422` for invalid content/references, `429` for application limits and cooldowns, `500` for persistence failures, and `502`/`503`/`504` for synchronous generation failures (invalid output, Gateway unavailable, timeout or unknown outcome). Automatic batch failures appear as sanitised outcome codes in the event read. Do not expose secrets or raw provider internals in UI errors.

An acknowledged save means the persistent write completed. Keep the existing document and local edits after failures. Serialize store updates in the single backend process and check revisions within that write operation; UI disabling alone does not enforce the contract. On a lost response, re-fetch saved state and reconcile before reporting success or overwriting a local draft.

### Service boundaries and storage trade-offs

- Frontend: render state, collect changes, inspect sources and call the event HTTP API. It never calls the AI Gateway or OpenAI directly.
- Event backend: validate requests, calculate counts, manage jobs/freshness, validate references and own all event-store writes.
- Generation in the event backend: the manual handler (synchronous) and the batch worker (one job per feedback window) share one generation service that captures saved input, calls the internal AI Gateway over TCP, validates returned evidence and publishes only an incoming preview.
- AI Gateway: separate internal Node/TypeScript service and the only place that calls OpenAI. Own provider credentials/client, model configuration, briefing prompt/profile, structured-output contract, provider deadlines and sanitised errors. It does not write event/job/briefing data. See [F8](09-ai-gateway.md).
- Model call inside the Gateway: fixed developer instructions plus untrusted feedback in a user message; return structured candidate content only. No tools, application writes or member matching. Follow [S1](08-openai-security.md).
- Persistence: save event state atomically; initialise only a missing store; reject a corrupt store without replacing it.

MySQL through TypeORM is the selected persistent store (confirmed 2026-10-03), accessed through the event backend's repository layer; each write is one InnoDB transaction holding the event row lock. Tables, relations and transaction boundaries are defined in [T4](13-data-model-and-transactions.md). Redis caches the single event read; every write and queue-state change flushes it using a versioned key so a concurrent read cannot repopulate stale data ([T3 §7](12-architecture-and-repository.md#7-response-cache-a4)). The separate AI Gateway has no event-store write access or database requirement. Exact durability behaviour must be verified by save/restart tests on the selected implementation.

The frontend stack is selected in [T1](10-frontend-technologies.md). The backend uses Node.js/TypeScript, Express, MySQL/TypeORM, Redis response caching, Zod and the OpenAI Agents SDK inside the Gateway, organised under pnpm as described in [T2](11-backend-technologies.md) and [T3](12-architecture-and-repository.md). Exact package versions and the model are pinned during implementation. BullMQ (batch queue), ioredis and native Node `net` TCP are confirmed; the Gateway adds no second queue. No dependencies have been installed. Reuse shared contracts and one Gateway client instead of duplicating DTOs, APIs or provider wrappers. Additional production dependencies require confirmation under the repository working agreements.

## Decisions

| Decision | Choice | Alternative / trade-off | Status |
| --- | --- | --- | --- |
| D1: Safe regeneration | Keep generated preview separate; replace saved briefing only on explicit Save | Confirmed choice; no in-place automatic replacement | Confirmed by coordinator, 2026-10-02 |
| D2: Editing | Edit existing text only; preserve section/item structure, source IDs and generation provenance | Confirmed choice; source inspection remains available | Confirmed by user, 2026-10-02 |
| D3: Persistent store | MySQL 8.4 through TypeORM in the repository layer; transactions with a per-event row lock | Replaces MongoDB/Mongoose; tables and transactions defined in T4 | Confirmed by user, 2026-10-03 |
| D4: AI provider and SDK | OpenAI Agents SDK inside the AI Gateway, using Responses and strict Structured Outputs | Exact model and package versions are pinned during implementation | Confirmed by user, 2026-10-02 |
| D5: Freshness rule | Compare the generation's stored per-member attendance snapshot and feedback digest with current saved data; an exact revert is current again | Previous default (stale forever after any change) needs extra revision bookkeeping and shows a false warning after a revert | Confirmed by user, 2026-10-03 |
| D6: Generation triggers | Coordinator Generate (synchronous, no queue) and new feedback notes (batched) | Notes from the test form/script stand in for the club's real feedback form | Confirmed by user, 2026-10-03 |
| D7: Batch queue implementation | BullMQ: throttle de-duplication (`ttl` = window) + `delay` = window, concurrency 1, built-in attempts with a provider-aware backoff, MySQL as record of outcome | Database queue rejected by user; Temporal possible behind the same port ([T5](14-generation-queue-implementation.md)) | Confirmed by user, 2026-10-03; spike is the first build step |
| D8: AI service boundary | Separate internal AI Gateway; event backend calls it over TCP; only Gateway calls OpenAI | Adds a process and service-failure handling; no direct-provider fallback | Confirmed by user, 2026-10-02; transport (native `net`, two lanes) confirmed 2026-10-03 |
| D9: Generation model | Manual: synchronous, single-flight, priority (own Gateway lane, wins the incoming slot, reserved budget). Automatic: fixed 3 s window per event, one generation reading all notes at run time, skip if nothing changed | Replaces the 2026-10-02 "latest request wins + FIFO winners" design | Confirmed by user, 2026-10-03 |
| D10: Frontend stack and conventions | React/TypeScript/Vite, React Router v7 (declarative), Axios + React Query, Astryx, React Hook Form + Zod, Zustand; layered data/UI, mutation toasts, kebab-case files/folders, multiple components allowed per file | Prefer latest compatible stable React; see T1 for state ownership | Confirmed by user, 2026-10-02; React Router added 2026-10-03 |
| D11: Backend stack and shared conventions | Express, MySQL/TypeORM, Redis API caching, Zod, Agents SDK; layered with repositories; one root pnpm workspace with `apps/*` and `packages/*`; Docker Compose for MySQL and Redis only | See T2/T3; TCP via native `net` | Confirmed by user, 2026-10-02; layout and store updated 2026-10-03 |
| D12: Conflict evidence | Each conflict cites at least two different feedback notes (one per opposing view); text describes differences between notes, not between members/attendees or counted people; related follow-up suggestions stay visible | A nested `positions[]` model would prove each side is cited but changes the content/edit contracts | Confirmed by user, 2026-10-03 |
| D13: Coordinator retry | No retry endpoint: the Retry button sends a normal synchronous Generate request; confirm first after `AI_OUTCOME_UNKNOWN` | Automatic bounded retries apply only to batch jobs (F7) | Confirmed by user, 2026-10-03 |
| D14: Live updates | Server-Sent Events `GET /api/events/:id/changes`; the server emits `changed` on every cache flush, and the client re-fetches the cached event read | Polling only (simpler, slower); WebSockets (bidirectional, unnecessary here) | Confirmed by user, 2026-10-03 |
| D15: Relational schema | Normalised MySQL schema with composite FKs enforcing citation and text-only-save rules, `preview_slots` table, binary-collated IDs, CHECK constraints, hand-written migrations ([T4](13-data-model-and-transactions.md)) | JSON document columns (fewer tables, no DB-level evidence integrity) | Confirmed by user, 2026-10-03 |
| D16: Briefing answers the four questions | "What happened" = code-built attendance overview (fact, states when attendance is incomplete) + one model-written feedback summary (reported, ≥ 1 cited note, ≤ 600 chars); UI headings follow the brief's four questions (amended 2026-10-04, user-approved: short headings Summary · Themes · Disagreements · Suggestions for you); internal keys unchanged | Attendance-only overview left the feedback side of "what happened" unanswered | Confirmed by user, 2026-10-03 |

All decisions are confirmed. Implementation began with the workspace scaffold and the BullMQ spike in [T5 §6](14-generation-queue-implementation.md#6-spike-first-build-step); the test feedback form and script (A15, F3) are the upstream producer for automatic note arrival. The implementation followed in Plans 1–5.

## Coverage and final demonstration

First demonstrate the client success criteria above using the supplied records and notes. The briefing must actually help the coordinator understand the event, recurring themes, disagreement and possible follow-ups. Then use the checks below to establish that its data, evidence and saved human work remain reliable.

| Brief obligation | Specification / evidence to collect during implementation |
| --- | --- |
| Correct seed, one-time initialisation and explicit reset | F1: clean start, modified-data restart and documented stopped-server reset |
| Accurate attendance and durable API saves | F2: three-state counts, invalid-write rejection and save/refresh/restart |
| Separate, anonymous and inspectable notes | F3: all eight exact notes and every cited note inspectable from its item's source disclosure |
| Real model with grounded output | F4: live provider call, roster-derived counts and source-linked sections |
| Opposing opinions and tentative follow-ups | F4: both meeting-point and start-time disagreements; no manufactured consensus or agreed plan |
| Validate references and explain limits | F3/F4/F5: unknown ID rejection, source inspection and explicit distinction between valid IDs and supported claims |
| Human edits persist and are protected | F5/F6: edited text and unchanged reference associations after restart, attendance changes, regeneration and failed generation |
| Attendance changes make content out of date | F6: saved edit, unchanged save, in-flight generation and refresh |
| Failures are clear and retryable | Feature acceptance cases: initial load, attendance save, model call, invalid output and briefing save |
| AI access is centralised | F8: Gateway-only credentials/provider calls, TCP authentication, bounded deadlines and no direct-provider fallback |
| Bursts of feedback are batched; the coordinator has priority | F7: 5 notes in one window → one call reading all notes; fixed cutoff; skip when nothing changed; manual generation never blocked or overwritten by batch results |

Acceptance cases in the feature files are requirements for future verification, not claims that an application or tests already exist. A mocked model response cannot satisfy the live-provider demonstration. Setup documentation must eventually include exact run/reset commands, required environment variables, storage location, chosen trade-offs, validation limitations and any reused template/boilerplate.

## Explicitly outside scope

Coordinator login/user-account authentication, multiple organisations, event creation, roster management, feedback editing or deletion, a production feedback-submission channel (the test form and script are an extension, [F3](03-feedback-and-sources.md#adding-feedback-test-extension)), messaging, audit subsystem, full briefing version history, cloud deployment and polished visual design remain outside scope. This does not exclude the internal service authentication required for the AI Gateway's TCP boundary.
