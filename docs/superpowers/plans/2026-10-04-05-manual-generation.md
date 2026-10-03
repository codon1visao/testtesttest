# Event Desk — Plan 3B: Manual Briefing Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the coordinator presses **Generate briefing**, the following happens:
1. The event API captures the saved attendance and every note.
2. It calls the AI Gateway over TCP on the interactive lane.
3. It validates the candidate against what it captured.
4. It commits the candidate into the incoming preview slot and returns it.

The web app shows Generate and Retry, the in-flight state, safe error guidance, and the incoming preview (read-only).

**Architecture:**
- **One service.** `BriefingGenerationService` is the only code that captures input, calls the Gateway, validates and commits (T5 §1). It runs TX4 (a read-only snapshot), then the Gateway call with no transaction open, then TX5 (event-row lock, incoming-slot rules, insert) or TX6 (record the outcome).
- **Single-flight.** `ManualGenerationCoordinator` makes manual generation single-flight per event: a second click or tab joins the running call. It also reports the in-flight run through the existing `GenerationActivity` port.
- **Pure decisions.** The overview text, the incoming-slot rules and the Gateway-failure mapping are pure functions in `modules/generation/domain`.
- **Gateway client.** The Gateway client is a port. Its adapter uses `@event-desk/tcp-rpc` and the shared `gateway-rpc` contract, and every integration test talks to a real TCP fake Gateway.
- **Web.** One mutation hook (`use-generate-briefing`) drives Generate and Retry.

**Tech Stack:**
- Existing Express 5, TypeORM 1.1 on MySQL 8.4, ioredis, Zod 4.
- `@event-desk/tcp-rpc` (Plan 3, now an event-api workspace dependency).
- React 19 with TanStack Query 5, Astryx, MSW 3.

**Spec:**
- [F4](../../specs/04-ai-briefing-generation.md): generation flow, output, backend validation, API and runtime states, F4-01…F4-18.
- [F7 "Coordinator priority"](../../specs/07-generation-queue.md#coordinator-priority): incoming-slot rules.
- [F8](../../specs/09-ai-gateway.md): failure table.
- [T3](../../specs/12-architecture-and-repository.md): §5 API and error codes, §7 cache flush triggers, §8 manual path, §9 Gateway, §11 layers and the web state table.
- [T4](../../specs/13-data-model-and-transactions.md): §2 relations, §5 retention, §6 TX4/TX5/TX6, §8 T4-01/T4-03/T4-05.
- [T5 §1–2](../../specs/14-generation-queue-implementation.md).
- [S1](../../specs/08-openai-security.md): S1-04, S1-09, S1-10.

---

## Plan series

| Plan | Scope | Status |
| --- | --- | --- |
| 1, 2, 2B | Foundation; event API core; coordinator web shell | Done |
| 3 — AI Gateway | tcp-rpc, gateway-rpc contract, `apps/ai-gateway`, `pnpm smoke:live` | Done |
| **3B — Manual generation (this plan)** | Prompt refinement, HTTP error-code split, Gateway client, generation persistence, `BriefingGenerationService`, `ManualGenerationCoordinator`, `POST /briefing-generations`, web Generate/Retry and read-only incoming preview | — |
| 4 — Review and save | Select the preview (TX7), F5 editor and save (TX8), F6 freshness notices, source disclosure, Playwright walkthrough | next |
| 5 — Automatic batches | Feedback form, BullMQ, SSE, persisted cooldown, daily budget, batch retries, S1 cases | — |
| 6 — Hand-in | README | — |

**Out of scope here:**
- **Persisted provider cooldown and the daily attempt budget** (T5 §3, F7) are Plan 5. Until then:
  - a Gateway `PROVIDER_RATE_LIMITED` becomes `429 PROVIDER_COOLDOWN` with the Gateway's `retryAfterMs`, but it is not stored;
  - the Gateway's in-memory daily backstop (`GATEWAY_DAILY_CALL_LIMIT`, default 40) bounds spend.
- **Selecting or editing the preview, freshness notices and source disclosure** are Plan 4. In this plan the incoming preview is displayed read-only. F4 step 7's automatic selection of a manual result (when the editor is clean) needs Plan 4's select endpoint, so it lands there too.
- **Live updates (SSE) and polling** are Plan 5. Plan 2B's refetch-on-focus still applies.

## Before you start

- Branch from `main`: `git switch -c feat/manual-generation main`.
- `pnpm infra:up`, and make sure `.env` exists. Integration tests need MySQL and Redis but never the real Gateway: they start a fake Gateway over TCP.
- Task 11's end-to-end check uses the real Gateway with the key in `.env`. It makes about three paid calls.

## Global Constraints

- **Earlier plans' constraints still apply:**
  - TypeScript strict, with no `any`, no non-null assertions and no string throws.
  - Exact pins, kebab-case files, and `.js` imports in Node packages (extensionless in `apps/web`).
  - Conventional commits with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Transactions (T4 §6):**
  - Every write transaction locks the event row first.
  - No transaction stays open across the Gateway call.
  - TX4 is `uow.readSnapshot` (with a revision check); TX5 and TX6 are `uow.run`.
  - Cache flushes and change notifications run only through `afterCommit`, or through `EventChangePublisher.publish` outside a transaction.
- **Manual generation (F4, T5 §2):**
  - It is synchronous and single-flight per event: a concurrent request joins the running call and gets the same result.
  - It is never retried automatically. The Retry button sends a fresh Generate.
  - Run ID: `manual:<uuidv7>`. Attempt ID: `"1"`. Lane: `"interactive"`.
  - Deadline: `now + MANUAL_GENERATION_TIMEOUT_MS` (default 60000), used both in the request's `deadlineAt` and in the client's wait. The Gateway answers `GATEWAY_RESPONSE_MARGIN_MS` before it.
- **Validation (F4 rules 3–4, S1-04):**
  - The candidate is parsed with `buildGeneratedSectionsSchema(capturedIds)` and then `validateEvidenceSections(sections, capturedIds)`, against the captured snapshot.
  - Any failure rejects the whole candidate with `502 OUTPUT_INVALID`. Nothing is persisted, and no slot changes.
  - `runId` and `attemptId` in the reply must match the request; otherwise the result is treated as `AI_OUTCOME_UNKNOWN`.
- **Deterministic facts (F4).** `attendanceOverview` is built in code from the captured counts: `"4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete)."` The clause in brackets appears only when `notRecorded > 0`. When `registered === 1`, use "member" (singular).
- **Incoming-slot rules** follow the F7 table exactly; see Task 4.
- **Error mapping**, with exactly these HTTP codes (T3 §5, F4):

| Gateway result | HTTP error | Status | Possibly billed |
| --- | --- | --- | --- |
| tcp-rpc `not-sent`, `GATEWAY_UNAVAILABLE` | `GATEWAY_UNAVAILABLE` | 503 | no |
| `GATEWAY_AUTH_FAILED` (logged at error: secret mismatch) | `GATEWAY_UNAVAILABLE` | 503 | no |
| `VALIDATION_FAILED` (the Gateway rejected our request: a bug), `INTERNAL` | `INTERNAL` | 500 | per `notSent` |
| `PROVIDER_NOT_CONFIGURED` | `PROVIDER_NOT_CONFIGURED` | 503 | no |
| `PROVIDER_RATE_LIMITED` | `PROVIDER_COOLDOWN` (`retryAfterMs` = Gateway value, else 60000) | 429 | no |
| `PROVIDER_TEMPORARY` | `GATEWAY_UNAVAILABLE` ("The AI provider is temporarily unavailable…") | 503 | per `notSent` |
| `DAILY_LIMIT_REACHED` | `DAILY_LIMIT_REACHED` | 429 | no |
| `PROVIDER_REFUSED`, `OUTPUT_INCOMPLETE`, `OUTPUT_INVALID` | same code | 502 | yes |
| `DEADLINE_EXCEEDED` | `DEADLINE_EXCEEDED` | 504 | yes (uncertain) |
| `AI_OUTCOME_UNKNOWN`; tcp-rpc `outcome-unknown`; unreadable or mismatched reply | `AI_OUTCOME_UNKNOWN` | 504 | yes (uncertain) |
| A result arriving after the deadline (F8-08) | `DEADLINE_EXCEEDED` | 504 | yes |
| The candidate fails backend validation | `OUTPUT_INVALID` | 502 | yes |
| TX5 fails | `RESULT_PERSIST_FAILED` | 500 | yes |

- **Retry confirmation (T3 §11, F8).** Retry asks for confirmation first when the failure code is `AI_OUTCOME_UNKNOWN` or `DEADLINE_EXCEEDED`, because the earlier call may have been charged. Other failures retry directly.
- **Outcomes (T4 TX6).** Every finished manual run writes one `generation_outcomes` row:
  - `succeeded` with `generation_id`; or
  - `failed` with the HTTP error code.

  Writing it prunes the event's outcomes to the latest 20. A failed outcome write is logged and never hides the original error.
- **Cache (T3 §7).** Flush, which notifies through `EventChangePublisher.publish`, at manual start and at manual finish (success or failure). The start flush makes `generation.manual` visible to other tabs.
- **Secrets (S1).** The event API reads `GATEWAY_SERVICE_SECRET` but never `OPENAI_*` (its `.env` loader allowlist already enforces that). The Gateway client refuses non-loopback hosts (tcp-rpc). Notes and model output are never logged.
- **Dependencies.** No new external packages. `apps/event-api` adds the workspace dependency `@event-desk/tcp-rpc`.

## Review Focus

1. **Double Generate.** The coordinator double-clicks Generate, or presses it in two tabs. Exactly one Gateway call must be made, and both requests get the same incoming preview. Pinned in Task 8 ("F4-07: two concurrent requests share one Gateway call").
2. **Attendance saved during generation.** Another tab saves attendance after the input was captured. The preview must stay tied to the captured attendance and show as not current, and the save must not be blocked. Pinned in Task 8 ("F4-08: a candidate stays tied to the attendance it read").
3. **The tab closes mid-generation.** The browser abandons the request. The server must still commit the result, and a later page load shows it with no second call. Pinned in Task 8 ("F4-17: an abandoned request still commits").
4. **Plausible but wrong output.** The Gateway returns a well-formed candidate that cites a note outside the captured set, or a theme with one note. Nothing may be persisted, and the response is `502 OUTPUT_INVALID`. Pinned in Task 8 ("F4-04/F4-12: an invalid candidate is never stored").
5. **The Gateway restarts mid-call.** The connection drops after the request was sent. The response must be `504 AI_OUTCOME_UNKNOWN`, the UI's Retry must ask for confirmation first, and the existing preview must stay untouched. Pinned in Task 8 (server) and Task 10 (UI confirmation).

---

## File structure

```text
packages/contracts/src/api/errors.ts            # Task 1: HTTP_ERROR_CODES / HttpErrorCode split
apps/ai-gateway/src/ai/briefing-prompt.ts       # Task 2: prompt v3 (theme discipline from the live smoke)

apps/event-api/src/
├─ config/env.ts                                # Task 3: GATEWAY_*, MANUAL_GENERATION_TIMEOUT_MS
├─ ports/
│  ├─ ai-gateway-client.ts                      # Task 3
│  ├─ id-generator.ts                           # Task 3
│  └─ unit-of-work.ts                           # Task 5: generations / slots / outcome writes in TransactionScope
├─ integrations/
│  ├─ tcp-ai-gateway-client.ts                  # Task 3
│  └─ uuid-v7-id-generator.ts                   # Task 3
├─ repositories/
│  ├─ generation-write-repository.ts            # Task 5
│  ├─ preview-slot-repository.ts                # Task 5
│  └─ outcome-repository.ts                     # Task 5 (replaces outcome-read-repository.ts)
├─ modules/generation/
│  ├─ domain/attendance-overview.ts · incoming-slot-rules.ts · generation-items.ts   # Task 4
│  ├─ gateway-failure.ts                        # Task 4 (Gateway result → AppError)
│  ├─ briefing-generation-service.ts            # Task 6
│  ├─ manual-generation-coordinator.ts          # Task 7 (+ GenerationActivity for manual runs)
│  └─ generation-controller.ts                  # Task 8
├─ compose.ts                                   # Task 8
└─ testing/fake-gateway.ts                      # Task 3 (a scripted tcp-rpc Gateway on 127.0.0.1)

apps/web/src/
├─ data/api/event-api.ts · data/mutations/use-generate-briefing.ts               # Task 9
├─ testing/fake-event-api.ts                    # Task 9 (POST /briefing-generations)
└─ features/briefing/
   ├─ briefing-panel.tsx · generate-briefing-control.tsx · briefing-preview.tsx  # Task 10
```

---
### Task 1: Split HTTP error codes from batch-only outcome codes

**Files:**
- Modify: `packages/contracts/src/api/errors.ts`, `packages/contracts/src/api/errors.test.ts`
- Modify: `apps/event-api/src/shared/app-error.ts`, `apps/event-api/src/testing/http.ts`
- Modify: `apps/web/src/data/http/api-error.ts`, `apps/web/src/testing/fake-event-api.ts`

**Interfaces:**
- Consumes: `ERROR_CODES` and `ErrorCodeSchema` (unchanged: every application code, still used by `generation_outcomes` and `GenerationStatusView.lastOutcome.code`).
- Produces (from `@event-desk/contracts`):
  - `BATCH_ONLY_ERROR_CODES = ["GATEWAY_AUTH_FAILED", "PROVIDER_RATE_LIMITED", "PROVIDER_TEMPORARY", "ATTEMPTS_EXHAUSTED"]`;
  - `HTTP_ERROR_CODES`, every other code;
  - `HttpErrorCodeSchema` and `type HttpErrorCode`;
  - `ERROR_HTTP_STATUS: Record<HttpErrorCode, number>`;
  - `ApiErrorBodySchema.error.code` is now `HttpErrorCodeSchema`.
  - `AppError.code` (event-api) and `ApiError.code` (web) are typed `HttpErrorCode`.

Plan 1 left a note in `errors.ts` that this split was owed ("Plan 3 adds the type split"). After this task, an HTTP response cannot carry a batch-only code, because the compiler rejects it.

- [ ] **Step 1: Write the failing test**

Replace the first test in `packages/contracts/src/api/errors.test.ts` and add one. The imports become `ApiErrorBodySchema, BATCH_ONLY_ERROR_CODES, ERROR_CODES, ERROR_HTTP_STATUS, HTTP_ERROR_CODES`.

```ts
  it("maps every HTTP code to a status, and only HTTP codes", () => {
    for (const code of HTTP_ERROR_CODES) expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
    expect(Object.keys(ERROR_HTTP_STATUS).toSorted()).toEqual([...HTTP_ERROR_CODES].toSorted());
  });

  it("partitions every code into HTTP or batch-only", () => {
    const http = new Set<string>(HTTP_ERROR_CODES);
    expect(BATCH_ONLY_ERROR_CODES.filter((code) => http.has(code))).toEqual([]);
    expect([...HTTP_ERROR_CODES, ...BATCH_ONLY_ERROR_CODES].toSorted()).toEqual([...ERROR_CODES].toSorted());
  });
```

Then add to the envelope test:

```ts
    const batchOnly = { error: { code: "PROVIDER_TEMPORARY", message: "x" } };
    expect(ApiErrorBodySchema.safeParse(batchOnly).success).toBe(false);
```

Run: `pnpm exec vitest run --project contracts src/api/errors.test.ts`
Expected: FAIL. `HTTP_ERROR_CODES` and `BATCH_ONLY_ERROR_CODES` are not exported.

- [ ] **Step 2: Implement**

In `packages/contracts/src/api/errors.ts`:

1. Remove the comment block above the four batch-only entries in `ERROR_CODES`, and keep the entries.
2. Add below `ErrorCode`:

```ts
/** Outcome codes for automatic (batch) runs only; an HTTP response never carries them. */
export const BATCH_ONLY_ERROR_CODES = [
  "GATEWAY_AUTH_FAILED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_TEMPORARY",
  "ATTEMPTS_EXHAUSTED",
] as const satisfies readonly ErrorCode[];
type BatchOnlyErrorCode = (typeof BATCH_ONLY_ERROR_CODES)[number];

const batchOnly: ReadonlySet<string> = new Set(BATCH_ONLY_ERROR_CODES);
export const HTTP_ERROR_CODES = ERROR_CODES.filter(
  (code): code is Exclude<ErrorCode, BatchOnlyErrorCode> => !batchOnly.has(code),
);
export const HttpErrorCodeSchema = z.enum(HTTP_ERROR_CODES as [HttpErrorCode, ...HttpErrorCode[]]);
export type HttpErrorCode = Exclude<ErrorCode, BatchOnlyErrorCode>;
```

3. Remove the four batch-only entries from `ERROR_HTTP_STATUS` and change its `satisfies` to `Record<HttpErrorCode, number>`.
4. In `ApiErrorBodySchema`, use `code: HttpErrorCodeSchema`.

`z.enum` needs a non-empty tuple type. The cast above is the narrowing from the filtered array; the partition test pins its contents. If Zod 4's `z.enum` accepts a `readonly HttpErrorCode[]` directly, drop the cast.

`apps/event-api/src/shared/app-error.ts`: import `type HttpErrorCode` instead of `ErrorCode`, and use it for the `code` field and the constructor parameter.

`apps/event-api/src/testing/http.ts`: `errorCodeOf` returns `HttpErrorCode`.

`apps/web/src/data/http/api-error.ts`: `ApiErrorDetails.code` and `ApiError.code` use `HttpErrorCode`.

`apps/web/src/testing/fake-event-api.ts`: `apiErrorResponse(status, code: HttpErrorCode, …)`.

- [ ] **Step 3: Run the tests and the type check**

Run: `pnpm exec vitest run --project contracts && pnpm typecheck`
Expected: PASS, and the type check finds no use of a batch-only code on an HTTP path. If it finds one, that is a real bug: report it and map it to an HTTP code, never back to `ErrorCode`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add packages/contracts apps/event-api/src apps/web/src
git commit -m "refactor(contracts): split HTTP error codes from batch-only outcome codes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Prompt v3 — theme discipline from the live smoke run

**Files:**
- Modify: `apps/ai-gateway/src/ai/briefing-prompt.ts`, `apps/ai-gateway/src/ai/briefing-prompt.test.ts`

**Interfaces:**
- Consumes: `BRIEFING_INSTRUCTIONS`, `PROMPT_VERSION` (Plan 3).
- Produces: `PROMPT_VERSION = "briefing.v3.2026-10-04"`; the instructions gain the theme-discipline paragraph below.

**Why:** the first live run (prompt v2) passed every structural check, but failed F4-11 and F4-13 on meaning:
- it padded the single-note route-length request (F07) into a "theme" by adding the unrelated rest-break note F06;
- it restated both conflicts (F01/F02, F03/F04) as themes as well.

Structural validation cannot catch either problem (F4: "Structural checks alone cannot certify it"), so the fix belongs in the instructions.

- [ ] **Step 1: Write the failing test**

In `apps/ai-gateway/src/ai/briefing-prompt.test.ts`, add these patterns to the rules list of the first test:

```ts
      /only if it expresses that same pattern/i,
      /never add an unrelated note to reach two/i,
      /belongs in suggestions, not themes/i,
      /do not repeat a disagreement as a theme/i,
```

Then change the version assertion to:

```ts
    expect(PROMPT_VERSION).toBe("briefing.v3.2026-10-04");
```

Run: `pnpm exec vitest run --project ai-gateway src/ai/briefing-prompt.test.ts`
Expected: FAIL on the new patterns and the version.

- [ ] **Step 2: Implement**

In `briefing-prompt.ts`, set `PROMPT_VERSION = "briefing.v3.2026-10-04"`. Insert this paragraph into `BRIEFING_INSTRUCTIONS` directly after the paragraph that begins "Identify themes as meaningful recurring patterns":

```ts
  "Cite a note in a theme only if it expresses that same pattern; never add an unrelated note to reach two IDs. A request or concern that appears in only one note belongs in suggestions, not themes. Record disagreements in conflicts, and do not repeat a disagreement as a theme unless the theme describes a further shared pattern.",
```

Change nothing else in the instructions.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project ai-gateway`
Expected: PASS. The adapter tests compare the request's `instructions` with `BRIEFING_INSTRUCTIONS`, so they pick up the new text automatically.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/ai-gateway/src/ai
git commit -m "fix(ai-gateway): prompt v3 keeps single-note requests out of themes and conflicts out of themes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Task 11 re-runs `pnpm smoke:live` against the real model to confirm the change.

---
### Task 3: Event API Gateway client, configuration and ID generation

**Files:**
- Modify: `apps/event-api/package.json` (dependency `@event-desk/tcp-rpc`: `workspace:*`), `apps/event-api/tsconfig.json` (reference `../../packages/tcp-rpc`)
- Modify: `apps/event-api/src/config/env.ts`, `apps/event-api/src/config/env.test.ts`, `apps/event-api/src/testing/test-config.ts`
- Create: `apps/event-api/src/ports/ai-gateway-client.ts`, `apps/event-api/src/ports/id-generator.ts`
- Create: `apps/event-api/src/integrations/tcp-ai-gateway-client.ts`, `apps/event-api/src/integrations/uuid-v7-id-generator.ts`
- Create: `apps/event-api/src/testing/fake-gateway.ts`
- Test: `apps/event-api/src/integrations/tcp-ai-gateway-client.test.ts`, `apps/event-api/src/integrations/uuid-v7-id-generator.test.ts`

**Interfaces:**
- Consumes:
  - `createRpcClient`, `createRpcServer`, `RpcCallError`, `RpcMessage` (tcp-rpc);
  - from `@event-desk/contracts/gateway-rpc`: `BRIEFING_GENERATE_V1`, `BriefingGenerateV1ResponseSchema`, `BriefingGenerateV1Input`, `BriefingGenerateV1Result`, `GatewayErrorCode`, `GatewayLane`;
  - `GenerationIdSchema`, `RunIdSchema` (contracts).
- Produces:
  - **Config.** `AppConfig` gains:
    - `gateway: { host: string; port: number; secret: string }`, from `GATEWAY_HOST` (loopback, default `127.0.0.1`), `GATEWAY_PORT` (default 4100) and `GATEWAY_SERVICE_SECRET` (required, at least 32 bytes);
    - `manualGenerationTimeoutMs`, from `MANUAL_GENERATION_TIMEOUT_MS` (5000–300000, default 60000).
  - **Gateway port** (`ports/ai-gateway-client.ts`):
    - `BriefingCallRequest = { runId: RunId; attemptId: string; lane: GatewayLane; deadlineAt: Date; input: BriefingGenerateV1Input }`;
    - `BriefingCallResult = { ok: true; result: BriefingGenerateV1Result } | { ok: false; code: GatewayErrorCode; notSent: boolean; retryAfterMs?: number }`;
    - `interface AiGatewayClient { generateBriefing(request: BriefingCallRequest): Promise<BriefingCallResult> }`. It never throws for Gateway or transport failures, and never retries.
  - **ID port** (`ports/id-generator.ts`): `interface IdGenerator { generationId(): GenerationId; itemId(): string; manualRunId(): RunId }`.
  - **Adapters:**
    - `new TcpAiGatewayClient({ host, port, secret }, logger)`;
    - `uuidV7(nowMs?, random?): string`;
    - `uuidV7IdGenerator: IdGenerator`.
  - **Test fake.**
    - `startFakeGateway(secret): Promise<FakeGateway>`, with `FakeGateway = { port; requests: RpcMessage[]; enqueue(reply: FakeGatewayReply): void; release(): void; close(): Promise<void> }`.
    - `FakeGatewayReply` is one of:
      - `{ kind: "result"; sections?: unknown; delayMs?: number }`;
      - `{ kind: "error"; code: GatewayErrorCode; notSent: boolean; retryAfterMs?: number }`;
      - `{ kind: "drop" }`;
      - `{ kind: "hold" }`;
      - `{ kind: "raw"; message: RpcMessage }`.
    - When no reply is queued it answers `"result"` with `minimalSections(request)`.
    - `"hold"` waits until `release()` or `close()`, then answers `"result"`.

**Classification in the adapter (F8, Plan 3's billing contract):**
- tcp-rpc `not-sent` becomes `{ ok: false, code: "GATEWAY_UNAVAILABLE", notSent: true }`.
- tcp-rpc `outcome-unknown`, an unreadable reply, or a reply whose non-null `runId`/`attemptId` differs from the request becomes `{ ok: false, code: "AI_OUTCOME_UNKNOWN", notSent: false }`.
- A Gateway error reply passes through unchanged: `code`, `notSent` and `retryAfterMs`.
- Log lines carry `requestId`, `runId`, `kind`/`reason` or `code` only.

- [ ] **Step 1: Wire the workspace dependency**

Add `"@event-desk/tcp-rpc": "workspace:*"` to `apps/event-api/package.json` `dependencies`, and `{ "path": "../../packages/tcp-rpc" }` to `apps/event-api/tsconfig.json` `references`. Run `pnpm install`.

- [ ] **Step 2: Write the failing tests**

`apps/event-api/src/integrations/uuid-v7-id-generator.test.ts`:

```ts
import { GenerationIdSchema, RunIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { uuidV7, uuidV7IdGenerator } from "./uuid-v7-id-generator.js";

describe("uuidV7", () => {
  it("encodes the millisecond timestamp, version 7 and the RFC 9562 variant", () => {
    const id = uuidV7(0x0199a4e87c1a, Buffer.alloc(10, 0xff));
    expect(id).toBe("0199a4e8-7c1a-7fff-bfff-ffffffffffff");
  });

  it("sorts by creation time and matches the contracts' GenerationId", () => {
    const earlier = uuidV7(1_000);
    const later = uuidV7(2_000);
    expect(earlier < later).toBe(true);
    expect(GenerationIdSchema.safeParse(uuidV7()).success).toBe(true);
  });

  it("produces manual run IDs and item IDs", () => {
    expect(uuidV7IdGenerator.manualRunId()).toMatch(/^manual:[0-9a-f-]{36}$/);
    expect(RunIdSchema.safeParse(uuidV7IdGenerator.manualRunId()).success).toBe(true);
    expect(uuidV7IdGenerator.itemId()).not.toBe(uuidV7IdGenerator.itemId());
  });
});
```

`apps/event-api/src/integrations/tcp-ai-gateway-client.test.ts`:

```ts
import { deriveAttendanceCounts, RunIdSchema, SUPPLIED_EVENT, SUPPLIED_FEEDBACK, SUPPLIED_MEMBERS } from "@event-desk/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { BriefingCallRequest } from "../ports/ai-gateway-client.js";
import { type FakeGateway, startFakeGateway } from "../testing/fake-gateway.js";
import { silentLogger } from "../testing/test-config.js";
import { TcpAiGatewayClient } from "./tcp-ai-gateway-client.js";

const SECRET = "event-api-test-secret-".padEnd(40, "s");
let gateway: FakeGateway | null = null;

afterEach(async () => {
  await gateway?.close();
  gateway = null;
});

function request(overrides: Partial<BriefingCallRequest> = {}): BriefingCallRequest {
  return {
    runId: RunIdSchema.parse("manual:0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f"),
    attemptId: "1",
    lane: "interactive",
    deadlineAt: new Date(Date.now() + 5_000),
    input: {
      event: { id: SUPPLIED_EVENT.id, name: SUPPLIED_EVENT.name, status: SUPPLIED_EVENT.status },
      counts: deriveAttendanceCounts(SUPPLIED_MEMBERS),
      feedback: SUPPLIED_FEEDBACK.map(({ id, text }) => ({ id, text })),
    },
    ...overrides,
  };
}

async function client() {
  gateway = await startFakeGateway(SECRET);
  return new TcpAiGatewayClient({ host: "127.0.0.1", port: gateway.port, secret: SECRET }, silentLogger);
}

describe("TcpAiGatewayClient", () => {
  it("sends one briefing.generate.v1 envelope and returns the result", async () => {
    const result = await (await client()).generateBriefing(request());
    expect(result.ok).toBe(true);
    expect(gateway?.requests).toHaveLength(1);
    expect(gateway?.requests[0]).toMatchObject({
      v: 1,
      operation: "briefing.generate.v1",
      runId: "manual:0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f",
      attemptId: "1",
      lane: "interactive",
    });
    expect(gateway?.requests[0]).not.toHaveProperty("auth");
  });

  it("passes a Gateway error through with notSent and retryAfterMs", async () => {
    const gatewayClient = await client();
    gateway?.enqueue({ kind: "error", code: "PROVIDER_RATE_LIMITED", notSent: false, retryAfterMs: 1500 });
    expect(await gatewayClient.generateBriefing(request())).toEqual({
      ok: false,
      code: "PROVIDER_RATE_LIMITED",
      notSent: false,
      retryAfterMs: 1500,
    });
  });

  it("F8-06: an unreachable Gateway is GATEWAY_UNAVAILABLE and known not sent", async () => {
    const gatewayClient = await client();
    await gateway?.close();
    gateway = null;
    expect(await gatewayClient.generateBriefing(request())).toEqual({ ok: false, code: "GATEWAY_UNAVAILABLE", notSent: true });
  });

  it("F8-07: a connection dropped after sending is AI_OUTCOME_UNKNOWN", async () => {
    const gatewayClient = await client();
    gateway?.enqueue({ kind: "drop" });
    expect(await gatewayClient.generateBriefing(request())).toEqual({ ok: false, code: "AI_OUTCOME_UNKNOWN", notSent: false });
  });

  it("F8-05 / F8-08: a reply for another run, or an unreadable reply, is AI_OUTCOME_UNKNOWN", async () => {
    const gatewayClient = await client();
    gateway?.enqueue({
      kind: "raw",
      message: {
        v: 1,
        ok: false,
        requestId: null,
        runId: "manual:someone-else",
        attemptId: "1",
        error: { code: "INTERNAL", message: "x", notSent: false },
      },
    });
    gateway?.enqueue({ kind: "raw", message: { hello: "world" } });
    const unknown = { ok: false, code: "AI_OUTCOME_UNKNOWN", notSent: false };
    expect(await gatewayClient.generateBriefing(request())).toEqual(unknown);
    expect(await gatewayClient.generateBriefing(request())).toEqual(unknown);
  });
});
```

The fake replies echo the request's `requestId`, so tcp-rpc's own correlation check passes and the adapter's `runId` check is what gets exercised. For `"raw"` replies the fake adds the request's `requestId` unless the message sets `requestId` itself.

Run: `pnpm exec vitest run --project event-api src/integrations`
Expected: FAIL. `Failed to resolve import "./uuid-v7-id-generator.js"` and `"../testing/fake-gateway.js"`.

- [ ] **Step 3: Implement the ports and the ID generator**

`apps/event-api/src/ports/ai-gateway-client.ts`:

```ts
import type { RunId } from "@event-desk/contracts";
import type {
  BriefingGenerateV1Input,
  BriefingGenerateV1Result,
  GatewayErrorCode,
  GatewayLane,
} from "@event-desk/contracts/gateway-rpc";

export interface BriefingCallRequest {
  runId: RunId;
  attemptId: string;
  lane: GatewayLane;
  deadlineAt: Date;
  input: BriefingGenerateV1Input;
}

/**
 * One attempt's result. `notSent: false` on a failure means the provider may have received (and
 * billed) the request: callers must not replay it automatically (F8, the Plan 3 contract).
 */
export type BriefingCallResult =
  | { ok: true; result: BriefingGenerateV1Result }
  | { ok: false; code: GatewayErrorCode; notSent: boolean; retryAfterMs?: number };

export interface AiGatewayClient {
  /** Exactly one RPC attempt; never retries; Gateway and transport failures are results, not throws. */
  generateBriefing(request: BriefingCallRequest): Promise<BriefingCallResult>;
}
```

`apps/event-api/src/ports/id-generator.ts`:

```ts
import type { GenerationId, RunId } from "@event-desk/contracts";

export interface IdGenerator {
  generationId(): GenerationId;
  /** IDs for briefing_items rows. */
  itemId(): string;
  /** `manual:<uuidv7>` (T5 §2). */
  manualRunId(): RunId;
}
```

`apps/event-api/src/integrations/uuid-v7-id-generator.ts`:

```ts
import { randomBytes } from "node:crypto";
import { GenerationIdSchema, RunIdSchema } from "@event-desk/contracts";
import type { IdGenerator } from "../ports/id-generator.js";

/**
 * RFC 9562 UUIDv7: 48-bit Unix milliseconds, version 7, variant 0b10, 74 random bits. Lowercase,
 * as the ascii_bin columns require. Time-ordered, so new generation rows append to the index.
 */
export function uuidV7(nowMs: number = Date.now(), random: Buffer = randomBytes(10)): string {
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(nowMs, 0, 6);
  random.copy(bytes, 6, 0, 10);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const uuidV7IdGenerator: IdGenerator = {
  generationId: () => GenerationIdSchema.parse(uuidV7()),
  itemId: () => uuidV7(),
  manualRunId: () => RunIdSchema.parse(`manual:${uuidV7()}`),
};
```

- [ ] **Step 4: Implement the adapter and the fake Gateway**

`apps/event-api/src/integrations/tcp-ai-gateway-client.ts`:

```ts
import { randomUUID } from "node:crypto";
import { BRIEFING_GENERATE_V1, BriefingGenerateV1ResponseSchema } from "@event-desk/contracts/gateway-rpc";
import { createRpcClient, RpcCallError, type RpcClient, type RpcMessage } from "@event-desk/tcp-rpc";
import type { AiGatewayClient, BriefingCallRequest, BriefingCallResult } from "../ports/ai-gateway-client.js";
import type { Logger } from "../shared/logger.js";

export interface GatewayClientConfig {
  host: string;
  port: number;
  secret: string;
}

const OUTCOME_UNKNOWN: BriefingCallResult = { ok: false, code: "AI_OUTCOME_UNKNOWN", notSent: false };

/** The event API's only way to the AI Gateway: one authenticated TCP request per attempt (F8). */
export class TcpAiGatewayClient implements AiGatewayClient {
  private readonly rpc: RpcClient;

  constructor(
    config: GatewayClientConfig,
    private readonly logger: Logger,
  ) {
    this.rpc = createRpcClient({ host: config.host, port: config.port, secret: config.secret });
  }

  async generateBriefing(request: BriefingCallRequest): Promise<BriefingCallResult> {
    const requestId = randomUUID();
    const log = this.logger.child({ requestId, runId: request.runId, attemptId: request.attemptId });
    let raw: RpcMessage;
    try {
      raw = await this.rpc.call(
        {
          v: 1,
          operation: BRIEFING_GENERATE_V1,
          requestId,
          runId: request.runId,
          attemptId: request.attemptId,
          lane: request.lane,
          deadlineAt: request.deadlineAt.toISOString(),
          input: request.input,
        },
        request.deadlineAt,
      );
    } catch (error) {
      if (!(error instanceof RpcCallError)) throw error;
      log.warn({ kind: error.kind, reason: error.reason }, "gateway call failed");
      return error.kind === "not-sent"
        ? { ok: false, code: "GATEWAY_UNAVAILABLE", notSent: true }
        : OUTCOME_UNKNOWN;
    }

    const parsed = BriefingGenerateV1ResponseSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn({ reason: "unreadable-reply" }, "gateway reply did not match the contract");
      return OUTCOME_UNKNOWN;
    }
    const reply = parsed.data;
    const mismatched =
      (reply.runId !== null && reply.runId !== request.runId) ||
      (reply.attemptId !== null && reply.attemptId !== request.attemptId);
    if (mismatched) {
      log.warn({ reason: "correlation-mismatch" }, "gateway reply was for another attempt");
      return OUTCOME_UNKNOWN;
    }
    if (reply.ok) return { ok: true, result: reply.result };
    log.info({ code: reply.error.code, notSent: reply.error.notSent }, "gateway answered with an error");
    return {
      ok: false,
      code: reply.error.code,
      notSent: reply.error.notSent,
      ...(reply.error.retryAfterMs === undefined ? {} : { retryAfterMs: reply.error.retryAfterMs }),
    };
  }
}
```

`apps/event-api/src/testing/fake-gateway.ts`:

```ts
import type { GatewayErrorCode } from "@event-desk/contracts/gateway-rpc";
import { createRpcServer, type RpcMessage } from "@event-desk/tcp-rpc";

export type FakeGatewayReply =
  | { kind: "result"; sections?: unknown; delayMs?: number }
  | { kind: "error"; code: GatewayErrorCode; notSent: boolean; retryAfterMs?: number }
  | { kind: "drop" }
  | { kind: "hold" }
  | { kind: "raw"; message: RpcMessage };

export interface FakeGateway {
  readonly port: number;
  /** Every authenticated request, auth removed, in arrival order. */
  readonly requests: RpcMessage[];
  enqueue(reply: FakeGatewayReply): void;
  /** Lets every held call answer. */
  release(): void;
  close(): Promise<void>;
}

/** A structurally valid candidate for whatever notes the request carried. */
export function minimalSections(request: RpcMessage): unknown {
  const input = request.input as { feedback?: { id: string }[] } | undefined;
  const firstId = input?.feedback?.[0]?.id ?? "F01";
  return {
    feedbackSummary: { text: "Fixture summary of the notes.", sourceIds: [firstId] },
    themes: [],
    conflicts: [],
    suggestions: [],
  };
}

/**
 * A scripted AI Gateway speaking the real tcp-rpc protocol on 127.0.0.1, so integration tests
 * exercise the real client adapter. Replies are consumed in order; the default is a valid result.
 */
export async function startFakeGateway(secret: string): Promise<FakeGateway> {
  const queue: FakeGatewayReply[] = [];
  const requests: RpcMessage[] = [];
  const held: (() => void)[] = [];
  const correlation = (request: RpcMessage) => ({
    requestId: request.requestId ?? null,
    runId: request.runId ?? null,
    attemptId: request.attemptId ?? null,
  });
  const result = (request: RpcMessage, sections: unknown): RpcMessage => ({
    v: 1,
    ok: true,
    ...correlation(request),
    result: {
      sections,
      model: "fake-model",
      promptVersion: "fake-prompt.v1",
      providerRequestId: "resp_fake",
      usage: { inputTokens: 1, outputTokens: 1 },
    },
  });
  const release = () => {
    for (const resume of held.splice(0)) resume();
  };

  const server = createRpcServer({
    secret,
    idleTimeoutMs: 2_000,
    async handle(request) {
      requests.push(request);
      const reply = queue.shift() ?? { kind: "result" };
      switch (reply.kind) {
        case "result":
          if (reply.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
          return result(request, reply.sections ?? minimalSections(request));
        case "error":
          return {
            v: 1,
            ok: false,
            ...correlation(request),
            error: {
              code: reply.code,
              message: "Fake gateway error.",
              notSent: reply.notSent,
              ...(reply.retryAfterMs === undefined ? {} : { retryAfterMs: reply.retryAfterMs }),
            },
          };
        case "drop":
          throw new Error("fake gateway drops the connection");
        case "hold":
          await new Promise<void>((resolve) => held.push(resolve));
          return result(request, minimalSections(request));
        case "raw":
          return { requestId: request.requestId ?? null, ...reply.message };
      }
    },
    reject: (rejection) => ({
      v: 1,
      ok: false,
      requestId: null,
      runId: null,
      attemptId: null,
      error: { code: "GATEWAY_AUTH_FAILED", message: `Fake gateway refused: ${rejection.reason}.`, notSent: true },
    }),
  });
  const port = await server.listen("127.0.0.1", 0);
  return {
    port,
    requests,
    enqueue: (reply) => queue.push(reply),
    release,
    async close() {
      release();
      await server.close();
    },
  };
}
```

`minimalSections` uses the `as` narrowing on the request's `input`, which only the fake reads. Keep it, since it is test-only. The `switch` must stay exhaustive: add `default: return assertNever(reply, "fake reply")` (from contracts) if lint asks for it.

- [ ] **Step 5: Extend the configuration**

In `apps/event-api/src/config/env.ts`:
- Add these to `EnvSchema`:

```ts
  GATEWAY_HOST: z
    .enum(["127.0.0.1", "::1", "localhost"], { error: "GATEWAY_HOST must be a loopback address" })
    .default("127.0.0.1"),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  GATEWAY_SERVICE_SECRET: z
    .string({ error: "is required" })
    .refine((value) => Buffer.byteLength(value, "utf8") >= 32, { message: "must be at least 32 bytes" }),
  MANUAL_GENERATION_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(60_000),
```

- Delete `GATEWAY_CLIENT_KEYS`, so `DOT_ENV_KEYS` is `Object.keys(EnvSchema.shape)` again.
- Add `gateway: { host: string; port: number; secret: string }` and `manualGenerationTimeoutMs: number` to `AppConfig` and to the object `loadConfig` returns.

`apps/event-api/src/testing/test-config.ts`: `integrationConfig` defaults gain `gateway: { host: "127.0.0.1", port: 1, secret: "event-api-test-secret-".padEnd(40, "s") }` and `manualGenerationTimeoutMs: 10_000`. Integration tests override `gateway.port` with the fake Gateway's port.

`apps/event-api/src/config/env.test.ts`:
- Add `GATEWAY_SERVICE_SECRET` (any 32+ byte value) to every env object that is expected to parse.
- Add a test that a missing or short `GATEWAY_SERVICE_SECRET` is a problem naming `GATEWAY_SERVICE_SECRET` and not echoing the value.
- Add a test that a non-loopback `GATEWAY_HOST` is rejected.
- Check that the existing allowlist test still sees the `GATEWAY_*` keys, now coming from the schema.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project event-api`
Expected: PASS.

- [ ] **Step 7: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0. `pnpm arch` holds:
- only `compose.ts` will import the adapter;
- `ports/` imports only contracts;
- raw `node:net` stays out of event-api source outside `testing/`.

```bash
git add apps/event-api pnpm-lock.yaml
git commit -m "feat(event-api): Gateway client over tcp-rpc, UUIDv7 IDs and Gateway configuration" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Generation domain — overview, incoming-slot rules, items, and Gateway-failure mapping

**Files:**
- Create: `apps/event-api/src/modules/generation/domain/attendance-overview.ts`, `.../domain/incoming-slot-rules.ts`, `.../domain/generation-items.ts`
- Create: `apps/event-api/src/modules/generation/gateway-failure.ts`
- Test: `apps/event-api/src/modules/generation/domain/domain.test.ts`, `apps/event-api/src/modules/generation/gateway-failure.test.ts`

**Interfaces:**
- Consumes:
  - from contracts: `AttendanceCounts`, `EvidenceSections`, `FeedbackId`, `GenerationTrigger`, `HttpErrorCode` (Task 1), `GatewayErrorCode`;
  - from Task 3: `BriefingCallResult`;
  - `AppError`.
- Produces:
  - `buildAttendanceOverview(counts: AttendanceCounts): string`;
  - for the incoming slot:
    - `IncomingCandidate = { trigger: GenerationTrigger; inputCapturedAt: Date }`;
    - `IncomingDecision = { kind: "replace" } | { kind: "keep"; outcome: "superseded" | "superseded_by_manual" }`;
    - `decideIncoming(current: IncomingCandidate | null, candidate: IncomingCandidate): IncomingDecision`;
  - for items:
    - `ITEM_SECTIONS = ["summary", "theme", "conflict", "suggestion"]` and `type ItemSection`;
    - `NewItem = { id: string; section: ItemSection; position: number; text: string; sourceIds: FeedbackId[] }`;
    - `toGenerationItems(sections: EvidenceSections, newId: () => string): NewItem[]`;
  - `gatewayFailureError(failure: Extract<BriefingCallResult, { ok: false }>): AppError`, which applies the mapping table in the Global Constraints.

The three `domain/` files are pure: the dependency-cruiser `domain-is-pure` rule allows only contracts, zod and other domain code. `gateway-failure.ts` builds `AppError`s, so it lives beside the service rather than in `domain/`.

- [ ] **Step 1: Write the failing tests**

`apps/event-api/src/modules/generation/domain/domain.test.ts`:

```ts
import { FeedbackIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { buildAttendanceOverview } from "./attendance-overview.js";
import { toGenerationItems } from "./generation-items.js";
import { decideIncoming } from "./incoming-slot-rules.js";

const ids = (...values: string[]) => values.map((value) => FeedbackIdSchema.parse(value));

describe("buildAttendanceOverview (F4, F4-02, F4-18)", () => {
  it("states the seed counts and flags incomplete attendance", () => {
    expect(buildAttendanceOverview({ registered: 4, attended: 1, absent: 2, notRecorded: 1 })).toBe(
      "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
    );
  });

  it("omits the clause when every member is recorded, and uses the singular for one member", () => {
    expect(buildAttendanceOverview({ registered: 4, attended: 2, absent: 2, notRecorded: 0 })).toBe(
      "4 registered members: 2 attended, 2 absent, 0 not recorded.",
    );
    expect(buildAttendanceOverview({ registered: 1, attended: 1, absent: 0, notRecorded: 0 })).toBe(
      "1 registered member: 1 attended, 0 absent, 0 not recorded.",
    );
  });
});

describe("decideIncoming (F7 'Who may replace the incoming preview')", () => {
  const at = (iso: string) => new Date(iso);
  const manual = (iso: string) => ({ trigger: "manual" as const, inputCapturedAt: at(iso) });
  const batch = (iso: string) => ({ trigger: "feedback_batch" as const, inputCapturedAt: at(iso) });

  it.each([
    ["an empty slot takes any result", null, batch("2026-10-04T10:00:00Z"), { kind: "replace" }],
    ["a manual result replaces an automatic one", batch("2026-10-04T10:00:00Z"), manual("2026-10-04T10:01:00Z"), { kind: "replace" }],
    ["a later automatic result replaces an automatic one", batch("2026-10-04T10:00:00Z"), batch("2026-10-04T10:01:00Z"), { kind: "replace" }],
    ["a later manual result replaces a manual one", manual("2026-10-04T10:00:00Z"), manual("2026-10-04T10:01:00Z"), { kind: "replace" }],
    ["an automatic result never replaces an unreviewed manual one", manual("2026-10-04T10:00:00Z"), batch("2026-10-04T10:05:00Z"), { kind: "keep", outcome: "superseded_by_manual" }],
    ["a result that read data earlier never replaces", manual("2026-10-04T10:01:00Z"), manual("2026-10-04T10:00:00Z"), { kind: "keep", outcome: "superseded" }],
    ["an earlier automatic result never replaces an automatic one", batch("2026-10-04T10:01:00Z"), batch("2026-10-04T10:00:00Z"), { kind: "keep", outcome: "superseded" }],
  ] as const)("%s", (_name, current, candidate, expected) => {
    expect(decideIncoming(current, candidate)).toEqual(expected);
  });
});

describe("toGenerationItems", () => {
  it("numbers items per section from 0 and keeps citation order", () => {
    let n = 0;
    const items = toGenerationItems(
      {
        feedbackSummary: { text: "Summary.", sourceIds: ids("F02", "F01") },
        themes: [{ text: "Rest breaks.", sourceIds: ids("F05", "F06") }],
        conflicts: [
          { text: "Start time.", sourceIds: ids("F03", "F04") },
          { text: "Meeting point.", sourceIds: ids("F01", "F02") },
        ],
        suggestions: [],
      },
      () => `item-${(n += 1)}`,
    );
    expect(items).toEqual([
      { id: "item-1", section: "summary", position: 0, text: "Summary.", sourceIds: ["F02", "F01"] },
      { id: "item-2", section: "theme", position: 0, text: "Rest breaks.", sourceIds: ["F05", "F06"] },
      { id: "item-3", section: "conflict", position: 0, text: "Start time.", sourceIds: ["F03", "F04"] },
      { id: "item-4", section: "conflict", position: 1, text: "Meeting point.", sourceIds: ["F01", "F02"] },
    ]);
  });
});
```

`apps/event-api/src/modules/generation/gateway-failure.test.ts`:

```ts
import { ERROR_HTTP_STATUS } from "@event-desk/contracts";
import type { GatewayErrorCode } from "@event-desk/contracts/gateway-rpc";
import { describe, expect, it } from "vitest";
import { gatewayFailureError } from "./gateway-failure.js";

const fail = (code: GatewayErrorCode, notSent = false, retryAfterMs?: number) =>
  gatewayFailureError({ ok: false, code, notSent, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) });

describe("gatewayFailureError (T3 §5, F4, F8)", () => {
  it.each([
    ["GATEWAY_UNAVAILABLE", "GATEWAY_UNAVAILABLE", 503],
    ["GATEWAY_AUTH_FAILED", "GATEWAY_UNAVAILABLE", 503],
    ["PROVIDER_TEMPORARY", "GATEWAY_UNAVAILABLE", 503],
    ["VALIDATION_FAILED", "INTERNAL", 500],
    ["INTERNAL", "INTERNAL", 500],
    ["PROVIDER_NOT_CONFIGURED", "PROVIDER_NOT_CONFIGURED", 503],
    ["PROVIDER_RATE_LIMITED", "PROVIDER_COOLDOWN", 429],
    ["DAILY_LIMIT_REACHED", "DAILY_LIMIT_REACHED", 429],
    ["PROVIDER_REFUSED", "PROVIDER_REFUSED", 502],
    ["OUTPUT_INCOMPLETE", "OUTPUT_INCOMPLETE", 502],
    ["OUTPUT_INVALID", "OUTPUT_INVALID", 502],
    ["DEADLINE_EXCEEDED", "DEADLINE_EXCEEDED", 504],
    ["AI_OUTCOME_UNKNOWN", "AI_OUTCOME_UNKNOWN", 504],
  ] as const)("maps %s to %s (%i)", (gatewayCode, httpCode, status) => {
    const error = fail(gatewayCode);
    expect(error.code).toBe(httpCode);
    expect(ERROR_HTTP_STATUS[error.code]).toBe(status);
    expect(error.message).toMatch(/\.$/);
  });

  it("carries the provider's wait, or a 60 s default, for a rate limit", () => {
    expect(fail("PROVIDER_RATE_LIMITED", false, 1_500).retryAfterMs).toBe(1_500);
    expect(fail("PROVIDER_RATE_LIMITED").retryAfterMs).toBe(60_000);
  });

  it("tells the coordinator that an uncertain attempt may have been charged", () => {
    expect(fail("AI_OUTCOME_UNKNOWN").message).toMatch(/may have been charged/);
    expect(fail("DEADLINE_EXCEEDED").message).toMatch(/may have been charged/);
    expect(fail("GATEWAY_UNAVAILABLE", true).message).toMatch(/saved work is unchanged/);
  });
});
```

Run: `pnpm exec vitest run --project event-api src/modules/generation`
Expected: FAIL on the missing modules.

- [ ] **Step 2: Implement the domain**

`apps/event-api/src/modules/generation/domain/attendance-overview.ts`:

```ts
import type { AttendanceCounts } from "@event-desk/contracts";

/**
 * The code-built "what happened" fact (F4, D16): the model never writes counts. The clause about
 * incomplete attendance appears only when someone is not recorded, never read as absence.
 */
export function buildAttendanceOverview(counts: AttendanceCounts): string {
  const noun = counts.registered === 1 ? "member" : "members";
  const facts = `${counts.registered} registered ${noun}: ${counts.attended} attended, ${counts.absent} absent, ${counts.notRecorded} not recorded`;
  return counts.notRecorded > 0 ? `${facts} (attendance is incomplete).` : `${facts}.`;
}
```

`apps/event-api/src/modules/generation/domain/incoming-slot-rules.ts`:

```ts
import type { GenerationTrigger } from "@event-desk/contracts";

export interface IncomingCandidate {
  trigger: GenerationTrigger;
  /** When the generation read its input (TX4 / TX10). */
  inputCapturedAt: Date;
}

export type IncomingDecision =
  | { kind: "replace" }
  | { kind: "keep"; outcome: "superseded" | "superseded_by_manual" };

/**
 * F7 "Who may replace the incoming preview". A result that read its data earlier never replaces
 * a newer one; an automatic result never replaces an unreviewed manual one (coordinator priority).
 * A manual result in the incoming slot is always unreviewed: selecting it moves it out (TX7).
 */
export function decideIncoming(current: IncomingCandidate | null, candidate: IncomingCandidate): IncomingDecision {
  if (current === null) return { kind: "replace" };
  if (candidate.inputCapturedAt.getTime() < current.inputCapturedAt.getTime()) {
    return { kind: "keep", outcome: "superseded" };
  }
  if (current.trigger === "manual" && candidate.trigger === "feedback_batch") {
    return { kind: "keep", outcome: "superseded_by_manual" };
  }
  return { kind: "replace" };
}
```

`apps/event-api/src/modules/generation/domain/generation-items.ts`:

```ts
import type { EvidenceSections, FeedbackId } from "@event-desk/contracts";

export const ITEM_SECTIONS = ["summary", "theme", "conflict", "suggestion"] as const;
export type ItemSection = (typeof ITEM_SECTIONS)[number];

export interface NewItem {
  id: string;
  section: ItemSection;
  /** 0-based within its section (T4 uq_item_position; the summary is always 0). */
  position: number;
  text: string;
  /** Citation order as returned; already de-duplicated by validateEvidenceSections. */
  sourceIds: FeedbackId[];
}

/** Flattens validated sections into briefing_items rows in reading order (T4 §5). */
export function toGenerationItems(sections: EvidenceSections, newId: () => string): NewItem[] {
  const list = (section: ItemSection, items: EvidenceSections["themes"]): NewItem[] =>
    items.map((item, position) => ({
      id: newId(),
      section,
      position,
      text: item.text,
      sourceIds: [...item.sourceIds],
    }));
  return [
    ...list("summary", [sections.feedbackSummary]),
    ...list("theme", sections.themes),
    ...list("conflict", sections.conflicts),
    ...list("suggestion", sections.suggestions),
  ];
}
```

- [ ] **Step 3: Implement the failure mapping**

`apps/event-api/src/modules/generation/gateway-failure.ts`:

```ts
import { assertNever } from "@event-desk/contracts";
import type { BriefingCallResult } from "../../ports/ai-gateway-client.js";
import { AppError } from "../../shared/app-error.js";

const DEFAULT_COOLDOWN_MS = 60_000;
const UNCHANGED = "Your saved work is unchanged";

/**
 * A failed Gateway attempt → the HTTP error the coordinator sees (T3 §5). Messages are fixed,
 * actionable sentences; uncertain outcomes say the attempt may have been charged (F8).
 */
export function gatewayFailureError(failure: Extract<BriefingCallResult, { ok: false }>): AppError {
  switch (failure.code) {
    case "GATEWAY_UNAVAILABLE":
    case "GATEWAY_AUTH_FAILED":
      return new AppError("GATEWAY_UNAVAILABLE", `The AI service is not reachable. ${UNCHANGED}; try again shortly.`);
    case "PROVIDER_TEMPORARY":
      return new AppError("GATEWAY_UNAVAILABLE", `The AI provider is temporarily unavailable. ${UNCHANGED}; try again shortly.`);
    case "VALIDATION_FAILED":
    case "INTERNAL":
      return new AppError("INTERNAL", `Briefing generation failed unexpectedly. ${UNCHANGED}.`);
    case "PROVIDER_NOT_CONFIGURED":
      return new AppError("PROVIDER_NOT_CONFIGURED", "The AI service has no provider configured. Ask the administrator to set the OpenAI key.");
    case "PROVIDER_RATE_LIMITED": {
      const retryAfterMs = failure.retryAfterMs ?? DEFAULT_COOLDOWN_MS;
      return new AppError(
        "PROVIDER_COOLDOWN",
        `The AI provider is limiting requests. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`,
        { retryAfterMs },
      );
    }
    case "DAILY_LIMIT_REACHED":
      return new AppError("DAILY_LIMIT_REACHED", `Today's generation limit is reached. ${UNCHANGED}.`);
    case "PROVIDER_REFUSED":
      return new AppError("PROVIDER_REFUSED", `The AI model declined to write this briefing. ${UNCHANGED}.`);
    case "OUTPUT_INCOMPLETE":
      return new AppError("OUTPUT_INCOMPLETE", `The AI model's answer was cut off. ${UNCHANGED}; you can generate again.`);
    case "OUTPUT_INVALID":
      return new AppError("OUTPUT_INVALID", `The AI model's answer broke the briefing rules and was discarded. ${UNCHANGED}.`);
    case "DEADLINE_EXCEEDED":
      return new AppError("DEADLINE_EXCEEDED", `The AI model did not finish in time; the attempt may have been charged. ${UNCHANGED}.`);
    case "AI_OUTCOME_UNKNOWN":
      return new AppError(
        "AI_OUTCOME_UNKNOWN",
        `The connection to the AI service was lost after the request was sent; the attempt may have been charged. ${UNCHANGED}.`,
      );
    default:
      return assertNever(failure.code, "gateway error code");
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project event-api src/modules/generation`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0. `domain-is-pure` holds for the three `domain/` files.

```bash
git add apps/event-api/src/modules/generation
git commit -m "feat(event-api): generation domain — overview, incoming-slot rules, items and Gateway-failure mapping" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Generation persistence — generations, the incoming slot and outcomes in the unit of work

**Files:**
- Modify: `apps/event-api/src/ports/unit-of-work.ts`
- Create: `apps/event-api/src/repositories/generation-write-repository.ts`, `apps/event-api/src/repositories/preview-slot-repository.ts`
- Rename and extend: `apps/event-api/src/repositories/outcome-read-repository.ts` → `outcome-repository.ts` (class `TypeOrmOutcomeRepository`)
- Modify: `apps/event-api/src/repositories/typeorm-unit-of-work.ts` (both scopes)
- Test: `apps/event-api/src/repositories/generation-write-repository.int.test.ts`

**Interfaces:**
- Consumes:
  - from Task 4: `NewItem`, `ItemSection`;
  - from contracts: `EventId`, `FeedbackId`, `GenerationId`, `GenerationTrigger`, `MemberAttendance`, `RunId`, `ErrorCode`, `RUN_OUTCOME_STATUSES`;
  - the entities in `persistence/entities/` (`GenerationEntity`, `AttendanceInputEntity`, `FeedbackInputEntity`, `BriefingItemEntity`, `BriefingItemSourceEntity`, `PreviewSlotEntity`, `GenerationOutcomeEntity`).
- Produces. In `ports/unit-of-work.ts`, `TransactionScope` gains:

```ts
export type RunOutcomeStatus = (typeof RUN_OUTCOME_STATUSES)[number];

export interface NewGeneration {
  id: GenerationId;
  eventId: EventId;
  runId: RunId;
  trigger: GenerationTrigger;
  model: string;
  promptVersion: string;
  attendanceOverview: string;
  feedbackDigest: string;
  inputCapturedAt: Date;
  generatedAt: Date;
  attendance: readonly MemberAttendance[];
  feedbackIds: readonly FeedbackId[];
  items: readonly NewItem[];
}

export interface GenerationWriteRepository {
  /** Inserts the immutable generation with its inputs, items and sources (T4 §2). */
  insert(generation: NewGeneration): Promise<void>;
  /** The generation a run already committed, if any: a run commits at most once (T4-05). */
  findIdByRunId(runId: RunId): Promise<GenerationId | null>;
  /** Deletes it with its children unless a slot or the saved briefing still references it (T4 §5). */
  deleteIfUnreferenced(eventId: EventId, generationId: GenerationId): Promise<boolean>;
}

export interface IncomingSlot {
  generationId: GenerationId;
  trigger: GenerationTrigger;
  inputCapturedAt: Date;
}

export interface PreviewSlotRepository {
  incoming(eventId: EventId): Promise<IncomingSlot | null>;
  /** Upserts preview_slots('incoming'). */
  putIncoming(eventId: EventId, generationId: GenerationId, now: Date): Promise<void>;
}

export interface NewOutcome {
  runId: RunId;
  eventId: EventId;
  trigger: GenerationTrigger;
  status: RunOutcomeStatus;
  /** Required when status is "failed" (T4 ck_outcome_error), otherwise null. */
  errorCode: ErrorCode | null;
  generationId: GenerationId | null;
  finishedAt: Date;
}

export interface OutcomeWriteRepository extends OutcomeReadRepository {
  /** Records the run's outcome (a repeated runId is a no-op) and keeps the event's latest 20. */
  record(outcome: NewOutcome): Promise<void>;
}

// TransactionScope additions:
//   generations: GenerationWriteRepository;
//   slots: PreviewSlotRepository;
//   outcomes: OutcomeWriteRepository;   // narrows ReadScope.outcomes
```

`ReadScope.outcomes` stays `OutcomeReadRepository`. Ports may import the `domain/` type `NewItem`, which `event-api-ports-are-abstract` allows.

**SQL that matters:**
- **`deleteIfUnreferenced`**: `DELETE FROM briefing_generations WHERE id = ? AND event_id = ? AND NOT EXISTS (SELECT 1 FROM preview_slots WHERE generation_id = ?) AND NOT EXISTS (SELECT 1 FROM saved_briefings WHERE generation_id = ?)`.
  - The children cascade, per the T4 DDL.
  - The RESTRICT foreign keys are the safety net.
  - It returns whether a row was deleted.
- **`putIncoming`**: `INSERT INTO preview_slots (event_id, slot, generation_id, updated_at) VALUES (?, 'incoming', ?, ?) ON DUPLICATE KEY UPDATE generation_id = VALUES(generation_id), updated_at = VALUES(updated_at)`.
- **`record`**:
  - Insert with `INSERT … ON DUPLICATE KEY UPDATE run_id = run_id`. Never use `INSERT IGNORE`, which would also hide CHECK violations.
  - Then prune with `DELETE FROM generation_outcomes WHERE event_id = ? AND run_id NOT IN (SELECT run_id FROM (SELECT run_id FROM generation_outcomes WHERE event_id = ? ORDER BY finished_at DESC, run_id DESC LIMIT 20) AS keep)`. The derived table works around MySQL's restriction on LIMIT in an IN subquery that reads the same table.
- **`insert`**:
  - It uses `manager.insert(Entity, rows)` in order: generation, attendance inputs, feedback inputs, items, sources.
  - It never calls `save`, `remove` or `manager.transaction`: the transaction is the unit of work's.
  - Source rows take `position` from their order in `item.sourceIds`.

- [ ] **Step 1: Write the failing integration test**

`apps/event-api/src/repositories/generation-write-repository.int.test.ts`:

```ts
import {
  FeedbackIdSchema,
  GenerationIdSchema,
  RunIdSchema,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_FEEDBACK_DIGEST,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NewGeneration } from "../ports/unit-of-work.js";
import { openTestDataSource, truncateAllTables } from "../testing/database.js";
import { insertEventFixture } from "../testing/sql-fixtures.js";
import { silentLogger } from "../testing/test-config.js";
import { TypeOrmUnitOfWork } from "./typeorm-unit-of-work.js";

const E101 = SUPPLIED_EVENT.id;
const AT = new Date("2026-10-04T10:00:00.000Z");
let dataSource: DataSource;
let uow: TypeOrmUnitOfWork;

const generation = (n: number, overrides: Partial<NewGeneration> = {}): NewGeneration => ({
  id: GenerationIdSchema.parse(`0199a4e8-7c1a-7cc2-9d6e-${String(n).padStart(12, "0")}`),
  eventId: E101,
  runId: RunIdSchema.parse(`manual:run-${n}`),
  trigger: "manual",
  model: "fake-model",
  promptVersion: "fake-prompt.v1",
  attendanceOverview: "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
  feedbackDigest: SUPPLIED_FEEDBACK_DIGEST,
  inputCapturedAt: AT,
  generatedAt: AT,
  attendance: SUPPLIED_MEMBERS.map((m) => ({ memberId: m.id, attendance: m.attendance })),
  feedbackIds: SUPPLIED_FEEDBACK.map((note) => note.id),
  items: [
    { id: `item-${n}-0`.padEnd(36, "0"), section: "summary", position: 0, text: "Summary.", sourceIds: [FeedbackIdSchema.parse("F01")] },
    { id: `item-${n}-1`.padEnd(36, "0"), section: "theme", position: 0, text: "Rest breaks.", sourceIds: [FeedbackIdSchema.parse("F06"), FeedbackIdSchema.parse("F05")] },
  ],
  ...overrides,
});
const count = async (table: string) =>
  Number((await dataSource.query<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n);

beforeAll(async () => {
  dataSource = await openTestDataSource();
  uow = new TypeOrmUnitOfWork(dataSource, silentLogger, { queryTimeoutMs: 5_000 });
});
afterAll(async () => {
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await insertEventFixture(dataSource);
});

describe("generation persistence (T4 TX5/TX6)", () => {
  it("inserts a generation and reads it back through the incoming slot", async () => {
    const g = generation(1);
    await uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      await tx.generations.insert(g);
      await tx.slots.putIncoming(E101, g.id, AT);
    });
    const slots = await uow.readSnapshot((scope) => scope.briefings.loadSlots(E101));
    expect(slots.incoming?.provenance).toMatchObject({ generationId: g.id, runId: g.runId, model: "fake-model" });
    expect(slots.incoming?.content.themes).toEqual([{ text: "Rest breaks.", sourceIds: ["F06", "F05"] }]);
    expect(slots.incoming?.content.attendanceOverview).toBe(g.attendanceOverview);
    expect(await uow.run((tx) => tx.slots.incoming(E101))).toEqual({ generationId: g.id, trigger: "manual", inputCapturedAt: AT });
    expect(await uow.run((tx) => tx.generations.findIdByRunId(g.runId))).toBe(g.id);
    expect(await uow.run((tx) => tx.generations.findIdByRunId(RunIdSchema.parse("manual:none")))).toBeNull();
  });

  it("T4-01: a source outside the generation's captured notes is rejected by the database", async () => {
    const g = generation(2, { feedbackIds: [FeedbackIdSchema.parse("F01")] });
    await expect(uow.run((tx) => tx.generations.insert(g))).rejects.toThrow();
    expect(await count("briefing_generations")).toBe(0);
  });

  it("T4-03: deletes a replaced generation only once nothing references it", async () => {
    const first = generation(3);
    const second = generation(4, { runId: RunIdSchema.parse("manual:run-4b") });
    await uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      await tx.generations.insert(first);
      await tx.slots.putIncoming(E101, first.id, AT);
      expect(await tx.generations.deleteIfUnreferenced(E101, first.id)).toBe(false);
      await tx.generations.insert(second);
      await tx.slots.putIncoming(E101, second.id, AT);
      expect(await tx.generations.deleteIfUnreferenced(E101, first.id)).toBe(true);
    });
    expect(await count("briefing_generations")).toBe(1);
    expect(await count("briefing_items")).toBe(2);
    expect(await count("generation_feedback_inputs")).toBe(SUPPLIED_FEEDBACK.length);
  });

  it("records outcomes once per run and keeps the latest 20", async () => {
    const outcome = (n: number) => ({
      runId: RunIdSchema.parse(`manual:run-${n}`),
      eventId: E101,
      trigger: "manual" as const,
      status: "failed" as const,
      errorCode: "GATEWAY_UNAVAILABLE" as const,
      generationId: null,
      finishedAt: new Date(AT.getTime() + n * 1_000),
    });
    await uow.run(async (tx) => {
      for (let n = 1; n <= 22; n += 1) await tx.outcomes.record(outcome(n));
      await tx.outcomes.record(outcome(22));
    });
    expect(await count("generation_outcomes")).toBe(20);
    expect(await uow.readSnapshot((scope) => scope.outcomes.latest(E101))).toMatchObject({ runId: "manual:run-22", status: "failed" });
    const oldest = await dataSource.query<{ run_id: string }[]>("SELECT run_id FROM generation_outcomes ORDER BY finished_at LIMIT 1");
    expect(oldest[0]?.run_id).toBe("manual:run-3");
  });
});
```

Item IDs only need to be unique 36-character ASCII. The helper pads them, so they never have to pass as real UUIDs.

Run: `pnpm test:integration -- generation-write-repository`
Expected: FAIL. `tx.generations` is undefined, which makes the type check fail first. The RED evidence can be either the `tsc` error or the failed run.

- [ ] **Step 2: Implement the ports and repositories**

Apply the `ports/unit-of-work.ts` additions above. Implement:

`apps/event-api/src/repositories/generation-write-repository.ts`:

```ts
import type { EventId, GenerationId, RunId } from "@event-desk/contracts";
import { GenerationIdSchema } from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import {
  AttendanceInputEntity,
  BriefingItemEntity,
  BriefingItemSourceEntity,
  FeedbackInputEntity,
  GenerationEntity,
} from "../persistence/entities/generation.entities.js";
import { PreviewSlotEntity, SavedBriefingEntity } from "../persistence/entities/briefing-slot.entities.js";
import type { GenerationWriteRepository, NewGeneration } from "../ports/unit-of-work.js";
import { parseStoredRow } from "./row-parsing.js";

export class TypeOrmGenerationWriteRepository implements GenerationWriteRepository {
  constructor(private readonly manager: EntityManager) {}

  async insert(g: NewGeneration): Promise<void> {
    await this.manager.insert(GenerationEntity, {
      id: g.id,
      eventId: g.eventId,
      runId: g.runId,
      triggerType: g.trigger,
      model: g.model,
      promptVersion: g.promptVersion,
      attendanceOverview: g.attendanceOverview,
      feedbackDigest: g.feedbackDigest,
      inputCapturedAt: g.inputCapturedAt,
      generatedAt: g.generatedAt,
    });
    await this.manager.insert(
      AttendanceInputEntity,
      g.attendance.map((a) => ({ generationId: g.id, eventId: g.eventId, memberId: a.memberId, attendance: a.attendance })),
    );
    await this.manager.insert(
      FeedbackInputEntity,
      g.feedbackIds.map((feedbackId) => ({ generationId: g.id, eventId: g.eventId, feedbackId })),
    );
    await this.manager.insert(
      BriefingItemEntity,
      g.items.map((item) => ({ id: item.id, generationId: g.id, section: item.section, position: item.position, text: item.text })),
    );
    const sources = g.items.flatMap((item) =>
      item.sourceIds.map((feedbackId, position) => ({ itemId: item.id, generationId: g.id, feedbackId, position })),
    );
    if (sources.length > 0) await this.manager.insert(BriefingItemSourceEntity, sources);
  }

  async findIdByRunId(runId: RunId): Promise<GenerationId | null> {
    const row = await this.manager.findOne(GenerationEntity, { where: { runId }, select: { id: true } });
    return row === null ? null : parseStoredRow(GenerationIdSchema, row.id, "briefing_generations");
  }

  async deleteIfUnreferenced(eventId: EventId, generationId: GenerationId): Promise<boolean> {
    const result = await this.manager
      .createQueryBuilder()
      .delete()
      .from(GenerationEntity)
      .where("id = :generationId AND event_id = :eventId", { generationId, eventId })
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM ${this.table(PreviewSlotEntity)} WHERE generation_id = :generationId)`,
      )
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM ${this.table(SavedBriefingEntity)} WHERE generation_id = :generationId)`,
      )
      .execute();
    return (result.affected ?? 0) > 0;
  }

  private table(entity: typeof PreviewSlotEntity | typeof SavedBriefingEntity): string {
    return this.manager.connection.getMetadata(entity).tableName;
  }
}
```

If TypeORM's `DeleteResult.affected` is undefined for this driver, run the statement with `manager.query` and read `affectedRows` from the result header instead. Keep the same SQL.

`apps/event-api/src/repositories/preview-slot-repository.ts`:

```ts
import { type EventId, type GenerationId, GenerationIdSchema, GenerationTriggerSchema } from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import { z } from "zod";
import type { IncomingSlot, PreviewSlotRepository } from "../ports/unit-of-work.js";
import { parseStoredRow } from "./row-parsing.js";

const IncomingRowSchema = z.object({
  generation_id: GenerationIdSchema,
  trigger_type: GenerationTriggerSchema,
  input_captured_at: z.date(),
});

export class TypeOrmPreviewSlotRepository implements PreviewSlotRepository {
  constructor(private readonly manager: EntityManager) {}

  async incoming(eventId: EventId): Promise<IncomingSlot | null> {
    const rows = await this.manager.query<unknown[]>(
      `SELECT s.generation_id, g.trigger_type, g.input_captured_at
         FROM preview_slots s JOIN briefing_generations g ON g.id = s.generation_id
        WHERE s.event_id = ? AND s.slot = 'incoming'`,
      [eventId],
    );
    const [row] = rows;
    if (row === undefined) return null;
    const parsed = parseStoredRow(IncomingRowSchema, row, "preview_slots");
    return { generationId: parsed.generation_id, trigger: parsed.trigger_type, inputCapturedAt: parsed.input_captured_at };
  }

  async putIncoming(eventId: EventId, generationId: GenerationId, now: Date): Promise<void> {
    await this.manager.query(
      `INSERT INTO preview_slots (event_id, slot, generation_id, updated_at) VALUES (?, 'incoming', ?, ?)
       ON DUPLICATE KEY UPDATE generation_id = VALUES(generation_id), updated_at = VALUES(updated_at)`,
      [eventId, generationId, now],
    );
  }
}
```

`apps/event-api/src/repositories/outcome-repository.ts`: move `TypeOrmOutcomeReadRepository` here, rename it `TypeOrmOutcomeRepository implements OutcomeWriteRepository`, keep `latest()` unchanged, and add:

```ts
  async record(outcome: NewOutcome): Promise<void> {
    await this.manager.query(
      `INSERT INTO generation_outcomes (run_id, event_id, trigger_type, status, error_code, generation_id, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE run_id = run_id`,
      [outcome.runId, outcome.eventId, outcome.trigger, outcome.status, outcome.errorCode, outcome.generationId, outcome.finishedAt],
    );
    await this.manager.query(
      `DELETE FROM generation_outcomes WHERE event_id = ? AND run_id NOT IN (
         SELECT run_id FROM (SELECT run_id FROM generation_outcomes WHERE event_id = ?
           ORDER BY finished_at DESC, run_id DESC LIMIT 20) AS keep)`,
      [outcome.eventId, outcome.eventId],
    );
  }
```

Delete `outcome-read-repository.ts` and update its imports.

`typeorm-unit-of-work.ts`: `readScope` uses `new TypeOrmOutcomeRepository(manager)` for `outcomes`. `transactionScope` adds `generations: new TypeOrmGenerationWriteRepository(manager)`, `slots: new TypeOrmPreviewSlotRepository(manager)` and `outcomes: new TypeOrmOutcomeRepository(manager)`.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm test:integration`
Expected: PASS. That covers the new file plus every existing integration test: the briefing read repository now reads rows written by the real insert path.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0. `typeorm-only-in-persistence` holds, because only `repositories/` uses TypeORM.

```bash
git add apps/event-api/src
git commit -m "feat(event-api): persist generations, the incoming slot and run outcomes in the unit of work" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: `BriefingGenerationService` — capture (TX4), call, validate, commit (TX5) or record the failure (TX6)

**Files:**
- Create: `apps/event-api/src/modules/generation/briefing-generation-service.ts`
- Test: `apps/event-api/src/modules/generation/briefing-generation-service.int.test.ts`

**Interfaces:**
- Consumes:
  - `UnitOfWork` with the Task 5 scope; `AiGatewayClient`, `BriefingCallResult` (Task 3); `IdGenerator` (Task 3); `Clock`;
  - `EventChangePublisher["publish"]`; `Logger`; `loadBriefingViews` (`modules/briefing/briefing-views.ts`);
  - `buildAttendanceOverview`, `decideIncoming`, `toGenerationItems`, `gatewayFailureError` (Task 4);
  - from contracts: `buildGeneratedSectionsSchema`, `validateEvidenceSections`, `deriveAttendanceCounts`, `feedbackDigest`.
- Produces:
  - `new BriefingGenerationService(deps: BriefingGenerationDeps)`, with `BriefingGenerationDeps = { uow; gateway; ids; clock; changes: Pick<EventChangePublisher, "publish">; logger }`;
  - `generateManual(command: ManualGenerateCommand): Promise<BriefingView>`, where `ManualGenerateCommand = { eventId: EventId; runId: RunId; baseAttendanceRevision: number; deadlineAt: Date }`. It returns the incoming preview after the commit. It throws `AppError` with the codes in the Global Constraints mapping table, plus `ATTENDANCE_CONFLICT` and `EVENT_NOT_FOUND`.

**Flow (T5 §1, T4 §6).** This is the only code that captures, calls, validates and commits; Plan 5's batch processor will reuse the same private steps.
1. **TX4, read-only snapshot.**
   - Load the aggregate. If it is missing: `EVENT_NOT_FOUND`.
   - Check `attendanceRevision === baseAttendanceRevision`, else `409 ATTENDANCE_CONFLICT`. No Gateway call and no outcome are recorded: this is not a run.
   - Capture `inputCapturedAt = clock.now()`, the per-member statuses, the derived counts, every note (ID and text) and `feedbackDigest(notes)`.
2. **Gateway call**, with no transaction open: lane `interactive`, attempt `"1"`, the command's `deadlineAt`.
3. **Failure** → `fail(...)`.
   - `GATEWAY_AUTH_FAILED` additionally logs at error level: "GATEWAY_SERVICE_SECRET differs between event API and Gateway".
   - A reply received after `deadlineAt` (by `clock.now()`) is discarded as `DEADLINE_EXCEEDED` (F8-08).
4. **Validate** against the captured IDs. Parse with `buildGeneratedSectionsSchema(capturedIds)`, then run `validateEvidenceSections`. Any failure is `fail(OUTPUT_INVALID)`.
5. **TX5:**
   1. Lock the event.
   2. If `generations.findIdByRunId(runId)` exists, skip the writes (T4-05).
   3. Otherwise, `decideIncoming(current incoming, { trigger: "manual", inputCapturedAt })`:
      - on `replace`: insert the generation, put it in the incoming slot, delete the previous incoming generation if it is now unreferenced, and record `succeeded`;
      - on `keep`: record that outcome.
   4. Schedule `afterCommit(publish)`.
   5. Build the views with `loadBriefingViews` on the locked aggregate, and return `incomingPreview`.

   Any TX5 error is `fail(RESULT_PERSIST_FAILED)`, with the message: "The briefing was generated but could not be saved, so the attempt was charged. Your saved work is unchanged."
6. **`fail(command, error)`, TX6.** Record the outcome `failed` with `error.code`, then publish. Both steps swallow and log their own errors, and the method returns the original `AppError` for the caller to throw.
7. **Logs.** One info line on success: `runId`, `generationId`, `model`, `promptVersion`, `usage`, `durationMs`. One warn line on failure: `runId`, `code`. Never notes or output.

- [ ] **Step 1: Write the failing integration test**

`apps/event-api/src/modules/generation/briefing-generation-service.int.test.ts`:

```ts
import { RunIdSchema, SUPPLIED_EVENT, SUPPLIED_FEEDBACK, type BriefingView } from "@event-desk/contracts";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { uuidV7IdGenerator } from "../../integrations/uuid-v7-id-generator.js";
import type { AiGatewayClient, BriefingCallRequest, BriefingCallResult } from "../../ports/ai-gateway-client.js";
import type { IdGenerator } from "../../ports/id-generator.js";
import { TypeOrmUnitOfWork } from "../../repositories/typeorm-unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import { openTestDataSource, truncateAllTables } from "../../testing/database.js";
import { insertEventFixture, insertGenerationFixture, putPreviewSlot } from "../../testing/sql-fixtures.js";
import { silentLogger } from "../../testing/test-config.js";
import { BriefingGenerationService } from "./briefing-generation-service.js";

const E101 = SUPPLIED_EVENT.id;
const NOW = new Date("2026-10-04T10:00:00.000Z");
let dataSource: DataSource;
let uow: TypeOrmUnitOfWork;

const okSections = {
  feedbackSummary: { text: "Notes describe an enjoyable walk.", sourceIds: ["F01", "F08"] },
  themes: [{ text: "Requests for longer rest breaks.", sourceIds: ["F05", "F06"] }],
  conflicts: [{ text: "One note asks to start earlier; another note says that would be difficult.", sourceIds: ["F03", "F04"] }],
  suggestions: [{ text: "Consider checking the route length.", sourceIds: ["F07"] }],
};
const result = (sections: unknown = okSections): BriefingCallResult => ({
  ok: true,
  result: {
    sections: sections as never,
    model: "fake-model",
    promptVersion: "fake-prompt.v1",
    providerRequestId: "resp_1",
    usage: { inputTokens: 1, outputTokens: 1 },
  },
});

function setup(answer: (request: BriefingCallRequest) => Promise<BriefingCallResult>, overrides: { ids?: IdGenerator; now?: () => Date } = {}) {
  const calls: BriefingCallRequest[] = [];
  const gateway: AiGatewayClient = {
    generateBriefing: (request) => {
      calls.push(request);
      return answer(request);
    },
  };
  const publish = vi.fn(() => Promise.resolve());
  const service = new BriefingGenerationService({
    uow,
    gateway,
    ids: overrides.ids ?? uuidV7IdGenerator,
    clock: { now: overrides.now ?? (() => NOW) },
    changes: { publish },
    logger: silentLogger,
  });
  const command = (baseAttendanceRevision = 0) => ({
    eventId: E101,
    runId: RunIdSchema.parse(`manual:test-${Math.random().toString(36).slice(2)}`),
    baseAttendanceRevision,
    deadlineAt: new Date(NOW.getTime() + 60_000),
  });
  return { service, calls, publish, command };
}

async function appErrorOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError");
}
const rows = async (sql: string) => dataSource.query<Record<string, unknown>[]>(sql);
const outcomes = () => rows("SELECT status, error_code, generation_id FROM generation_outcomes ORDER BY finished_at");

beforeAll(async () => {
  dataSource = await openTestDataSource();
  uow = new TypeOrmUnitOfWork(dataSource, silentLogger, { queryTimeoutMs: 5_000 });
});
afterAll(async () => {
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await insertEventFixture(dataSource);
});

describe("BriefingGenerationService.generateManual", () => {
  it("F4-01/F4-02: captures the saved input, calls the interactive lane and commits the incoming preview", async () => {
    const { service, calls, publish, command } = setup(() => Promise.resolve(result()));
    const preview: BriefingView = await service.generateManual(command());

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ attemptId: "1", lane: "interactive" });
    expect(calls[0]?.input.counts).toEqual({ registered: 4, attended: 1, absent: 2, notRecorded: 1 });
    expect(calls[0]?.input.feedback.map((n) => n.id)).toEqual(SUPPLIED_FEEDBACK.map((n) => n.id));
    expect(JSON.stringify(calls[0]?.input)).not.toMatch(/Alex|Bea|Chris|Drew/); // S1: no roster names

    expect(preview.trigger).toBe("manual");
    expect(preview.content.attendanceOverview).toBe(
      "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
    );
    expect(preview.content.themes).toEqual(okSections.themes);
    expect(preview.freshness.current).toBe(true);
    expect(preview.provenance).toMatchObject({ model: "fake-model", promptVersion: "fake-prompt.v1", generatedAt: NOW.toISOString() });
    expect(await outcomes()).toEqual([{ status: "succeeded", error_code: null, generation_id: preview.provenance.generationId }]);
    expect(await rows("SELECT slot FROM preview_slots")).toEqual([{ slot: "incoming" }]);
    expect(publish).toHaveBeenCalledWith(E101);
  });

  it("checks the attendance baseline before any paid call", async () => {
    const { service, calls, command } = setup(() => Promise.resolve(result()));
    expect((await appErrorOf(service.generateManual(command(7)))).code).toBe("ATTENDANCE_CONFLICT");
    expect(calls).toHaveLength(0);
    expect(await outcomes()).toEqual([]);
  });

  it("F4-06: maps a Gateway failure, records the outcome and keeps every slot as it was", async () => {
    const { service, publish, command } = setup(() => Promise.resolve({ ok: false, code: "PROVIDER_REFUSED", notSent: false }));
    const error = await appErrorOf(service.generateManual(command()));
    expect(error.code).toBe("PROVIDER_REFUSED");
    expect(await outcomes()).toEqual([{ status: "failed", error_code: "PROVIDER_REFUSED", generation_id: null }]);
    expect(await rows("SELECT * FROM preview_slots")).toEqual([]);
    expect(publish).toHaveBeenCalledWith(E101);
  });

  it.each([
    ["cites a note outside the captured set", { ...okSections, suggestions: [{ text: "Consider it.", sourceIds: ["F09"] }] }],
    ["has a theme with one distinct note (F4-12)", { ...okSections, themes: [{ text: "Rest.", sourceIds: ["F05", "F05"] }] }],
    ["has a one-sided conflict (F4-15)", { ...okSections, conflicts: [{ text: "Start time.", sourceIds: ["F03"] }] }],
    ["has a blank summary", { ...okSections, feedbackSummary: { text: "   ", sourceIds: ["F01"] } }],
  ])("F4-04: rejects a candidate that %s without storing it", async (_name, sections) => {
    const { service, command } = setup(() => Promise.resolve(result(sections)));
    expect((await appErrorOf(service.generateManual(command()))).code).toBe("OUTPUT_INVALID");
    expect(await rows("SELECT id FROM briefing_generations")).toEqual([]);
    expect(await outcomes()).toEqual([{ status: "failed", error_code: "OUTPUT_INVALID", generation_id: null }]);
  });

  it("F8-08: discards a result that arrives after the deadline", async () => {
    let now = NOW;
    const { service, command } = setup(
      () => {
        now = new Date(NOW.getTime() + 61_000);
        return Promise.resolve(result());
      },
      { now: () => now },
    );
    expect((await appErrorOf(service.generateManual(command()))).code).toBe("DEADLINE_EXCEEDED");
    expect(await rows("SELECT id FROM briefing_generations")).toEqual([]);
  });

  it("replaces the previous incoming preview and removes it, but never a referenced one", async () => {
    const old = await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", old);
    const { service, command } = setup(() => Promise.resolve(result()));
    const first = await service.generateManual(command());
    expect(await rows(`SELECT id FROM briefing_generations WHERE id = '${old}'`)).toEqual([]);

    await dataSource.query("UPDATE preview_slots SET slot = 'selected' WHERE generation_id = ?", [first.provenance.generationId]);
    const second = await service.generateManual(command());
    expect(second.provenance.generationId).not.toBe(first.provenance.generationId);
    expect(await rows("SELECT slot, generation_id FROM preview_slots ORDER BY slot")).toEqual([
      { slot: "incoming", generation_id: second.provenance.generationId },
      { slot: "selected", generation_id: first.provenance.generationId },
    ]);
  });

  it("F4-08: a candidate stays tied to the attendance it read and is marked stale", async () => {
    const { service, command } = setup(async () => {
      await dataSource.query("UPDATE members SET attendance = 'attended' WHERE id = 'M03'");
      await dataSource.query("UPDATE events SET attendance_revision = attendance_revision + 1");
      return result();
    });
    const preview = await service.generateManual(command());
    expect(preview.provenance.input.counts).toEqual({ registered: 4, attended: 1, absent: 2, notRecorded: 1 });
    expect(preview.freshness.current).toBe(false);
    expect(preview.freshness.attendanceChanges).toEqual([{ memberId: "M03", from: "not_recorded", to: "attended" }]);
  });

  it("F4-09: a persistence failure is RESULT_PERSIST_FAILED and leaves every slot intact", async () => {
    const sameItemId: IdGenerator = { ...uuidV7IdGenerator, itemId: () => "0199a4e8-7c1a-7cc2-9d6e-000000000001" };
    const { service, command } = setup(() => Promise.resolve(result()), { ids: sameItemId });
    expect((await appErrorOf(service.generateManual(command()))).code).toBe("RESULT_PERSIST_FAILED");
    expect(await rows("SELECT * FROM preview_slots")).toEqual([]);
    expect(await outcomes()).toEqual([{ status: "failed", error_code: "RESULT_PERSIST_FAILED", generation_id: null }]);
  });
});
```

The `sections as never` in `result()` lets the tests pass deliberately invalid candidates through the port's type, exactly like a misbehaving Gateway would on the wire. It is test-only.

Run: `pnpm test:integration -- briefing-generation-service`
Expected: FAIL. `Failed to resolve import "./briefing-generation-service.js"`.

- [ ] **Step 2: Implement**

`apps/event-api/src/modules/generation/briefing-generation-service.ts`:

```ts
import {
  type BriefingView,
  buildGeneratedSectionsSchema,
  deriveAttendanceCounts,
  type EventId,
  type EvidenceSections,
  type FeedbackId,
  feedbackDigest,
  type MemberAttendance,
  type RunId,
  validateEvidenceSections,
} from "@event-desk/contracts";
import type { BriefingGenerateV1Input, BriefingGenerateV1Result } from "@event-desk/contracts/gateway-rpc";
import type { AiGatewayClient } from "../../ports/ai-gateway-client.js";
import type { Clock } from "../../ports/clock.js";
import type { IdGenerator } from "../../ports/id-generator.js";
import type { UnitOfWork } from "../../ports/unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import type { Logger } from "../../shared/logger.js";
import { loadBriefingViews } from "../briefing/briefing-views.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import { buildAttendanceOverview } from "./domain/attendance-overview.js";
import { toGenerationItems } from "./domain/generation-items.js";
import { decideIncoming } from "./domain/incoming-slot-rules.js";
import { gatewayFailureError } from "./gateway-failure.js";

export interface BriefingGenerationDeps {
  uow: UnitOfWork;
  gateway: AiGatewayClient;
  ids: IdGenerator;
  clock: Clock;
  changes: Pick<EventChangePublisher, "publish">;
  logger: Logger;
}

export interface ManualGenerateCommand {
  eventId: EventId;
  runId: RunId;
  baseAttendanceRevision: number;
  deadlineAt: Date;
}

/** What TX4 read: the generation's immutable input. */
interface CapturedInput {
  capturedAt: Date;
  attendance: MemberAttendance[];
  feedbackIds: FeedbackId[];
  feedbackDigest: string;
  input: BriefingGenerateV1Input;
}

/**
 * The one generation path (T5 §1): capture saved input, call the Gateway with no transaction
 * open, validate against the captured snapshot, commit with the incoming-slot rules. Manual runs
 * are never retried here; the batch processor (Plan 5) reuses these steps.
 */
export class BriefingGenerationService {
  constructor(private readonly deps: BriefingGenerationDeps) {}

  async generateManual(command: ManualGenerateCommand): Promise<BriefingView> {
    const started = Date.now();
    const captured = await this.capture(command);
    const call = await this.deps.gateway.generateBriefing({
      runId: command.runId,
      attemptId: "1",
      lane: "interactive",
      deadlineAt: command.deadlineAt,
      input: captured.input,
    });
    if (!call.ok) {
      if (call.code === "GATEWAY_AUTH_FAILED") {
        this.deps.logger.error({ runId: command.runId }, "GATEWAY_SERVICE_SECRET differs between the event API and the Gateway");
      }
      throw await this.fail(command, gatewayFailureError(call));
    }
    if (this.deps.clock.now().getTime() > command.deadlineAt.getTime()) {
      throw await this.fail(command, gatewayFailureError({ ok: false, code: "DEADLINE_EXCEEDED", notSent: false }));
    }
    const sections = this.validate(call.result, captured.feedbackIds);
    if (sections === null) {
      throw await this.fail(command, gatewayFailureError({ ok: false, code: "OUTPUT_INVALID", notSent: false }));
    }

    let preview: BriefingView;
    try {
      preview = await this.commit(command, captured, call.result, sections);
    } catch (error) {
      this.deps.logger.error({ err: error, runId: command.runId }, "generated briefing could not be stored");
      throw await this.fail(
        command,
        new AppError(
          "RESULT_PERSIST_FAILED",
          "The briefing was generated but could not be saved, so the attempt was charged. Your saved work is unchanged.",
          { cause: error },
        ),
      );
    }
    this.deps.logger.info(
      {
        runId: command.runId,
        generationId: preview.provenance.generationId,
        model: call.result.model,
        promptVersion: call.result.promptVersion,
        usage: call.result.usage,
        durationMs: Date.now() - started,
      },
      "briefing generated",
    );
    return preview;
  }

  /** TX4: a consistent read-only snapshot; the revision check happens before any paid call. */
  private capture(command: ManualGenerateCommand): Promise<CapturedInput> {
    return this.deps.uow.readSnapshot(async (scope) => {
      const aggregate = await scope.events.findAggregate(command.eventId);
      if (aggregate === null) throw new AppError("EVENT_NOT_FOUND", `Event ${command.eventId} was not found.`);
      if (aggregate.attendanceRevision !== command.baseAttendanceRevision) {
        throw new AppError(
          "ATTENDANCE_CONFLICT",
          "Attendance was saved elsewhere since you loaded it. Reload, then generate again.",
        );
      }
      const notes = aggregate.feedback.map(({ id, text }) => ({ id, text }));
      return {
        capturedAt: this.deps.clock.now(),
        attendance: aggregate.members.map((m) => ({ memberId: m.id, attendance: m.attendance })),
        feedbackIds: notes.map((note) => note.id),
        feedbackDigest: await feedbackDigest(notes),
        input: {
          event: { id: aggregate.event.id, name: aggregate.event.name, status: aggregate.event.status },
          counts: deriveAttendanceCounts(aggregate.members),
          feedback: notes,
        },
      };
    });
  }

  /** F4 rules 1–5 against the CAPTURED note set; any failure rejects the whole candidate. */
  private validate(result: BriefingGenerateV1Result, capturedIds: readonly FeedbackId[]): EvidenceSections | null {
    const parsed = buildGeneratedSectionsSchema(capturedIds).safeParse(result.sections);
    if (!parsed.success) return null;
    const evidence = validateEvidenceSections(parsed.data, capturedIds);
    return evidence.ok ? evidence.sections : null;
  }

  /** TX5: lock, apply the F7 incoming-slot rules, insert, record the outcome; flush after commit. */
  private commit(
    command: ManualGenerateCommand,
    captured: CapturedInput,
    result: BriefingGenerateV1Result,
    sections: EvidenceSections,
  ): Promise<BriefingView> {
    return this.deps.uow.run(async (tx) => {
      const aggregate = await tx.events.lockForUpdate(command.eventId);
      const now = this.deps.clock.now();
      if ((await tx.generations.findIdByRunId(command.runId)) === null) {
        const current = await tx.slots.incoming(command.eventId);
        const decision = decideIncoming(current, { trigger: "manual", inputCapturedAt: captured.capturedAt });
        const outcome = { runId: command.runId, eventId: command.eventId, trigger: "manual" as const, errorCode: null, finishedAt: now };
        if (decision.kind === "replace") {
          const generationId = this.deps.ids.generationId();
          await tx.generations.insert({
            id: generationId,
            eventId: command.eventId,
            runId: command.runId,
            trigger: "manual",
            model: result.model,
            promptVersion: result.promptVersion,
            attendanceOverview: buildAttendanceOverview(captured.input.counts),
            feedbackDigest: captured.feedbackDigest,
            inputCapturedAt: captured.capturedAt,
            generatedAt: now,
            attendance: captured.attendance,
            feedbackIds: captured.feedbackIds,
            items: toGenerationItems(sections, () => this.deps.ids.itemId()),
          });
          await tx.slots.putIncoming(command.eventId, generationId, now);
          if (current !== null) await tx.generations.deleteIfUnreferenced(command.eventId, current.generationId);
          await tx.outcomes.record({ ...outcome, status: "succeeded", generationId });
        } else {
          await tx.outcomes.record({ ...outcome, status: decision.outcome, generationId: null });
        }
        tx.afterCommit(() => this.deps.changes.publish(command.eventId));
      }
      const views = await loadBriefingViews(tx, command.eventId, aggregate.members, aggregate.feedback);
      if (views.incomingPreview === null) {
        throw new AppError("INTERNAL", "The generated briefing is missing after its commit.");
      }
      return views.incomingPreview;
    });
  }

  /** TX6: record the failed run and tell readers; never hides the original error. */
  private async fail(command: ManualGenerateCommand, error: AppError): Promise<AppError> {
    this.deps.logger.warn({ runId: command.runId, code: error.code }, "manual generation failed");
    try {
      await this.deps.uow.run(async (tx) => {
        await tx.outcomes.record({
          runId: command.runId,
          eventId: command.eventId,
          trigger: "manual",
          status: "failed",
          errorCode: error.code,
          generationId: null,
          finishedAt: this.deps.clock.now(),
        });
        tx.afterCommit(() => this.deps.changes.publish(command.eventId));
      });
    } catch (recordError) {
      this.deps.logger.warn({ err: recordError, runId: command.runId }, "could not record the failed run");
      await this.deps.changes.publish(command.eventId);
    }
    return error;
  }
}
```

TX6 records with no row lock, per the T4 TX6 row. `loadBriefingViews` takes a `Pick<ReadScope, "briefings">`, which `tx` satisfies.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm test:integration -- briefing-generation-service`
Expected: PASS.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify && pnpm test:integration`
Expected: exit 0. `services-use-ports` holds: the service imports ports only, never `integrations/` or `repositories/`. Its test may import adapters, because test files are exempt.

```bash
git add apps/event-api/src/modules/generation
git commit -m "feat(event-api): BriefingGenerationService captures, calls the Gateway, validates and commits the incoming preview" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: `ManualGenerationCoordinator` — single-flight, deadline, and in-flight activity

**Files:**
- Create: `apps/event-api/src/modules/generation/manual-generation-coordinator.ts`
- Test: `apps/event-api/src/modules/generation/manual-generation-coordinator.test.ts`

**Interfaces:**
- Consumes:
  - `BriefingGenerationService.generateManual` and `ManualGenerateCommand` (Task 6);
  - `IdGenerator` (Task 3); `Clock`;
  - `EventChangePublisher["publish"]`; `GenerationActivity` and `GenerationActivitySnapshot` (`ports/generation-activity.ts`).
- Produces:
  - `new ManualGenerationCoordinator(deps: ManualGenerationDeps)`, with `ManualGenerationDeps = { generation: Pick<BriefingGenerationService, "generateManual">; ids; clock; changes; timeoutMs: number }`;
  - `generate(eventId: EventId, baseAttendanceRevision: number): Promise<BriefingView>`;
  - `current(eventId): Promise<GenerationActivitySnapshot>`, implementing `GenerationActivity`: `manual: { runId, startedAt }` while a run is in flight, `batch: null` and `cooldownUntil: null` until Plan 5.

**Rules (T5 §2, F4, T3 §7):**
- **One run per event.** A second `generate` for the same event while one runs returns the same promise (F4-07); its `baseAttendanceRevision` is ignored. Different events run independently.
- **New run.**
  - `runId = ids.manualRunId()`, `startedAt = clock.now()`, `deadlineAt = startedAt + timeoutMs`.
  - The run is registered before any `await`, so a concurrent caller always finds it.
- **Flush order.** Flush at start, after registration, so a re-read shows `generation.manual`. Flush again at finish, after removal, so a re-read shows `manual: null`. The service's own after-commit flush happens while the run is still registered, which is why the finish flush is needed.
- **Release on every path.** The run is removed whether it succeeds or fails, so a failure never blocks the next Generate.
- **No HTTP awareness.** The coordinator never looks at the HTTP request. A disconnected browser does not cancel the run (F4-17).

- [ ] **Step 1: Write the failing test**

`apps/event-api/src/modules/generation/manual-generation-coordinator.test.ts`:

```ts
import { type BriefingView, EventIdSchema, GenerationIdSchema, RunIdSchema } from "@event-desk/contracts";
import { buildBriefingView } from "@event-desk/contracts/testing";
import { describe, expect, it, vi } from "vitest";
import type { IdGenerator } from "../../ports/id-generator.js";
import { AppError } from "../../shared/app-error.js";
import type { ManualGenerateCommand } from "./briefing-generation-service.js";
import { ManualGenerationCoordinator } from "./manual-generation-coordinator.js";

const E101 = EventIdSchema.parse("E101");
const START = new Date("2026-10-04T10:00:00.000Z");
let runs = 0;
const ids: IdGenerator = {
  generationId: () => GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f"),
  itemId: () => "item",
  manualRunId: () => RunIdSchema.parse(`manual:run-${(runs += 1)}`),
};

function setup() {
  const pending: { command: ManualGenerateCommand; result: PromiseWithResolvers<BriefingView> }[] = [];
  const events: string[] = [];
  const generation = {
    generateManual: vi.fn((command: ManualGenerateCommand) => {
      events.push("generate");
      const result = Promise.withResolvers<BriefingView>();
      pending.push({ command, result });
      return result.promise;
    }),
  };
  const coordinator = new ManualGenerationCoordinator({
    generation,
    ids,
    clock: { now: () => START },
    changes: {
      publish: vi.fn(async () => {
        events.push(`publish:${(await coordinator.current(E101)).manual === null ? "idle" : "running"}`);
      }),
    },
    timeoutMs: 60_000,
  });
  return { coordinator, generation, pending, events };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ManualGenerationCoordinator", () => {
  it("F4-07: concurrent requests join one run and get the same preview", async () => {
    const { coordinator, generation, pending } = setup();
    const first = coordinator.generate(E101, 0);
    const second = coordinator.generate(E101, 3);
    await settled();
    expect(generation.generateManual).toHaveBeenCalledTimes(1);
    const preview = buildBriefingView();
    pending[0]?.result.resolve(preview);
    expect(await first).toBe(preview);
    expect(await second).toBe(preview);
  });

  it("starts the run with a manual run ID and a deadline of startedAt + timeout", async () => {
    const { coordinator, pending } = setup();
    void coordinator.generate(E101, 0);
    await settled();
    expect(pending[0]?.command).toMatchObject({ eventId: E101, baseAttendanceRevision: 0 });
    expect(pending[0]?.command.runId).toMatch(/^manual:run-\d+$/);
    expect(pending[0]?.command.deadlineAt).toEqual(new Date(START.getTime() + 60_000));
  });

  it("reports the run while it is in flight and flushes before and after it", async () => {
    const { coordinator, pending, events } = setup();
    const run = coordinator.generate(E101, 0);
    await settled();
    expect((await coordinator.current(E101)).manual).toEqual({
      runId: pending[0]?.command.runId,
      startedAt: START.toISOString(),
    });
    pending[0]?.result.resolve(buildBriefingView());
    await run;
    expect(events).toEqual(["publish:running", "generate", "publish:idle"]);
    expect(await coordinator.current(E101)).toEqual({ manual: null, batch: null, cooldownUntil: null });
  });

  it("releases the event after a failure so the next Generate starts a new run", async () => {
    const { coordinator, generation, pending } = setup();
    const failed = coordinator.generate(E101, 0);
    await settled();
    pending[0]?.result.reject(new AppError("GATEWAY_UNAVAILABLE", "down"));
    await expect(failed).rejects.toBeInstanceOf(AppError);
    void coordinator.generate(E101, 0);
    await settled();
    expect(generation.generateManual).toHaveBeenCalledTimes(2);
    expect(pending[1]?.command.runId).not.toBe(pending[0]?.command.runId);
  });
});
```

Run: `pnpm exec vitest run --project event-api src/modules/generation/manual-generation-coordinator.test.ts`
Expected: FAIL. `Failed to resolve import "./manual-generation-coordinator.js"`.

- [ ] **Step 2: Implement**

`apps/event-api/src/modules/generation/manual-generation-coordinator.ts`:

```ts
import type { BriefingView, EventId, RunId } from "@event-desk/contracts";
import type { Clock } from "../../ports/clock.js";
import type { GenerationActivity, GenerationActivitySnapshot } from "../../ports/generation-activity.js";
import type { IdGenerator } from "../../ports/id-generator.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import type { BriefingGenerationService } from "./briefing-generation-service.js";

export interface ManualGenerationDeps {
  generation: Pick<BriefingGenerationService, "generateManual">;
  ids: IdGenerator;
  clock: Clock;
  changes: Pick<EventChangePublisher, "publish">;
  /** MANUAL_GENERATION_TIMEOUT_MS: the whole run's deadline, passed to the Gateway (F8). */
  timeoutMs: number;
}

interface InFlightRun {
  runId: RunId;
  startedAt: Date;
  result: Promise<BriefingView>;
}

/**
 * Manual generation is synchronous and single-flight per event (T5 §2, F4-07): a second click or
 * tab joins the running call. One event-api process is assumed (T3 §14). Also the live source of
 * `generation.manual` for the event view.
 */
export class ManualGenerationCoordinator implements GenerationActivity {
  private readonly inFlight = new Map<EventId, InFlightRun>();

  constructor(private readonly deps: ManualGenerationDeps) {}

  generate(eventId: EventId, baseAttendanceRevision: number): Promise<BriefingView> {
    const running = this.inFlight.get(eventId);
    if (running !== undefined) return running.result;

    const runId = this.deps.ids.manualRunId();
    const startedAt = this.deps.clock.now();
    const deadlineAt = new Date(startedAt.getTime() + this.deps.timeoutMs);
    // Deferred by one microtask so the run is registered before its first flush reads it.
    const result = Promise.resolve().then(() => this.run(eventId, runId, deadlineAt, baseAttendanceRevision));
    this.inFlight.set(eventId, { runId, startedAt, result });
    return result;
  }

  current(eventId: EventId): Promise<GenerationActivitySnapshot> {
    const run = this.inFlight.get(eventId);
    return Promise.resolve({
      manual: run === undefined ? null : { runId: run.runId, startedAt: run.startedAt.toISOString() },
      batch: null,
      cooldownUntil: null,
    });
  }

  private async run(eventId: EventId, runId: RunId, deadlineAt: Date, baseAttendanceRevision: number): Promise<BriefingView> {
    try {
      await this.deps.changes.publish(eventId); // other tabs see "Generating briefing…"
      return await this.deps.generation.generateManual({ eventId, runId, baseAttendanceRevision, deadlineAt });
    } finally {
      this.inFlight.delete(eventId);
      await this.deps.changes.publish(eventId); // and see it finish
    }
  }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project event-api src/modules/generation`
Expected: PASS.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/event-api/src/modules/generation
git commit -m "feat(event-api): single-flight manual generation with in-flight activity and start/finish flushes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `POST /api/events/:eventId/briefing-generations`, composition and end-to-end API tests

**Files:**
- Create: `apps/event-api/src/modules/generation/generation-controller.ts`
- Modify: `apps/event-api/src/compose.ts`
- Delete: `apps/event-api/src/modules/event/no-generation-activity.ts`
- Test: `apps/event-api/src/modules/generation/generation-api.int.test.ts`

**Interfaces:**
- Consumes:
  - `ManualGenerationCoordinator` (Task 7); `BriefingGenerationService` (Task 6);
  - `TcpAiGatewayClient`, `uuidV7IdGenerator`, `startFakeGateway` (Task 3);
  - `parseEventId`, `validateBody` (`http/validate.ts`);
  - `GenerateBriefingRequestSchema`, `GenerateBriefingResponseSchema` (contracts).
- Produces:
  - `generationRoutes(coordinator: Pick<ManualGenerationCoordinator, "generate">): Router`, which returns `201 { incomingPreview }`;
  - `ComposeOptions` gains `ids?: IdGenerator` (default `uuidV7IdGenerator`).
  - The event view's `generation.manual` now comes from the coordinator.

- [ ] **Step 1: Write the failing integration test**

`apps/event-api/src/modules/generation/generation-api.int.test.ts`:

```ts
import {
  EventViewSchema,
  GenerateBriefingResponseSchema,
  SUPPLIED_EVENT,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import type { Redis } from "ioredis";
import request from "supertest";
import type { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { composeEventApi, type EventApi } from "../../compose.js";
import { openTestDataSource, truncateAllTables } from "../../testing/database.js";
import { type FakeGateway, startFakeGateway } from "../../testing/fake-gateway.js";
import { errorCodeOf } from "../../testing/http.js";
import { clearApplicationKeys, openTestRedis } from "../../testing/redis.js";
import { insertGenerationFixture, putPreviewSlot } from "../../testing/sql-fixtures.js";
import { integrationConfig, silentLogger } from "../../testing/test-config.js";

const E101 = SUPPLIED_EVENT.id;
const ORIGIN = "http://localhost:5173";
const SECRET = integrationConfig().gateway.secret;
let dataSource: DataSource;
let redis: Redis;
let gateway: FakeGateway;
let api: EventApi;

const generate = (base = 0, origin = ORIGIN) =>
  request(api.app).post(`/api/events/${E101}/briefing-generations`).set("Origin", origin).send({ baseAttendanceRevision: base });
const view = async () => EventViewSchema.parse((await request(api.app).get(`/api/events/${E101}`)).body);
const count = async (sql: string) => Number((await dataSource.query<{ n: number }[]>(sql))[0]?.n);

beforeAll(async () => {
  dataSource = await openTestDataSource();
  redis = await openTestRedis();
});
afterAll(async () => {
  await clearApplicationKeys(redis);
  redis.disconnect();
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await clearApplicationKeys(redis);
  gateway = await startFakeGateway(SECRET);
  api = await composeEventApi(
    integrationConfig({ gateway: { host: "127.0.0.1", port: gateway.port, secret: SECRET } }),
    { logger: silentLogger },
  );
});
afterEach(async () => {
  await api.close();
  await gateway.close();
});

describe("POST /api/events/:eventId/briefing-generations", () => {
  it("F4-01/F4-10: generates synchronously into the incoming slot and the next read shows it", async () => {
    const res = await generate();
    expect(res.status).toBe(201);
    const { incomingPreview } = GenerateBriefingResponseSchema.parse(res.body);
    expect(incomingPreview.trigger).toBe("manual");
    expect(gateway.requests).toHaveLength(1);
    const after = await view();
    expect(after.incomingPreview).toEqual(incomingPreview);
    expect(after.generation.manual).toBeNull();
    expect(after.generation.lastOutcome).toMatchObject({ trigger: "manual", status: "succeeded" });
  });

  it("Review Focus 1 / F4-07: two concurrent requests share one Gateway call", async () => {
    gateway.enqueue({ kind: "hold" });
    const first = generate();
    const second = generate();
    const responses = Promise.all([first, second]);
    await vi.waitFor(() => {
      expect(gateway.requests).toHaveLength(1);
    });
    expect((await view()).generation.manual).not.toBeNull(); // another tab sees "Generating briefing…"
    gateway.release();
    const [a, b] = await responses;
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(GenerateBriefingResponseSchema.parse(a.body).incomingPreview.provenance.generationId).toBe(
      GenerateBriefingResponseSchema.parse(b.body).incomingPreview.provenance.generationId,
    );
    expect(gateway.requests).toHaveLength(1);
  });

  it("Review Focus 2 / F4-08: a candidate stays tied to the attendance it read; the save is not blocked", async () => {
    gateway.enqueue({ kind: "hold" });
    const pending = generate();
    await vi.waitFor(() => {
      expect(gateway.requests).toHaveLength(1);
    });
    const roster = SUPPLIED_MEMBERS.map((m) => ({ id: m.id, attendance: m.id === "M03" ? "attended" : m.attendance }));
    const save = await request(api.app)
      .put(`/api/events/${E101}/attendance`)
      .set("Origin", ORIGIN)
      .send({ baseAttendanceRevision: 0, members: roster });
    expect(save.status).toBe(200);
    gateway.release();
    const { incomingPreview } = GenerateBriefingResponseSchema.parse((await pending).body);
    expect(incomingPreview.freshness.current).toBe(false);
    expect(incomingPreview.freshness.attendanceChanges).toEqual([{ memberId: "M03", from: "not_recorded", to: "attended" }]);
  });

  it("Review Focus 3 / F4-17: an abandoned request still commits, with no second call", async () => {
    gateway.enqueue({ kind: "hold" });
    await expect(generate().timeout(300)).rejects.toThrow(/timeout/i);
    gateway.release();
    await vi.waitFor(async () => {
      expect(await count("SELECT COUNT(*) AS n FROM preview_slots WHERE slot = 'incoming'")).toBe(1);
    });
    expect((await view()).incomingPreview?.trigger).toBe("manual");
    expect(gateway.requests).toHaveLength(1);
  });

  it("Review Focus 4 / F4-04 / F4-12: an invalid candidate is never stored", async () => {
    gateway.enqueue({
      kind: "result",
      sections: {
        feedbackSummary: { text: "Summary.", sourceIds: ["F01"] },
        themes: [{ text: "Rest breaks.", sourceIds: ["F05"] }],
        conflicts: [],
        suggestions: [],
      },
    });
    const res = await generate();
    expect([res.status, errorCodeOf(res)]).toEqual([502, "OUTPUT_INVALID"]);
    expect(await count("SELECT COUNT(*) AS n FROM briefing_generations")).toBe(0);
    expect((await view()).generation.lastOutcome).toMatchObject({ status: "failed", code: "OUTPUT_INVALID" });
  });

  it("Review Focus 5 / F8-07: a dropped connection is 504 AI_OUTCOME_UNKNOWN and keeps the existing preview", async () => {
    const existing = await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", existing);
    gateway.enqueue({ kind: "drop" });
    const res = await generate();
    expect([res.status, errorCodeOf(res)]).toEqual([504, "AI_OUTCOME_UNKNOWN"]);
    expect((await view()).incomingPreview?.provenance.generationId).toBe(existing);
  });

  it("F8-06: an unreachable Gateway is an immediate 503 GATEWAY_UNAVAILABLE", async () => {
    await gateway.close();
    const res = await generate();
    expect([res.status, errorCodeOf(res)]).toEqual([503, "GATEWAY_UNAVAILABLE"]);
    expect((await view()).generation.lastOutcome).toMatchObject({ status: "failed", code: "GATEWAY_UNAVAILABLE" });
  });

  it("F8-09: a provider rate limit is 429 PROVIDER_COOLDOWN with the wait", async () => {
    gateway.enqueue({ kind: "error", code: "PROVIDER_RATE_LIMITED", notSent: false, retryAfterMs: 2_000 });
    const res = await generate();
    expect([res.status, errorCodeOf(res)]).toEqual([429, "PROVIDER_COOLDOWN"]);
    expect(res.headers["retry-after"]).toBe("2");
    expect(res.body).toMatchObject({ error: { retryAfterMs: 2_000 } });
  });

  it("checks the attendance baseline before any paid call", async () => {
    const res = await generate(5);
    expect([res.status, errorCodeOf(res)]).toEqual([409, "ATTENDANCE_CONFLICT"]);
    expect(gateway.requests).toHaveLength(0);
  });

  it("S1-09: a cross-origin request never reaches the Gateway", async () => {
    const res = await generate(0, "http://evil.example");
    expect([res.status, errorCodeOf(res)]).toEqual([403, "ORIGIN_REJECTED"]);
    expect(gateway.requests).toHaveLength(0);
  });

  it("rejects a body with anything but the attendance baseline", async () => {
    const res = await request(api.app)
      .post(`/api/events/${E101}/briefing-generations`)
      .set("Origin", ORIGIN)
      .send({ baseAttendanceRevision: 0, prompt: "write a poem" });
    expect([res.status, errorCodeOf(res)]).toEqual([400, "VALIDATION_FAILED"]);
    expect(gateway.requests).toHaveLength(0);
  });
});
```

Run: `pnpm test:integration -- generation-api`
Expected: FAIL with 404 `NOT_FOUND`, because the route does not exist yet.

- [ ] **Step 2: Implement the controller and wire the composition root**

`apps/event-api/src/modules/generation/generation-controller.ts`:

```ts
import { GenerateBriefingRequestSchema, type GenerateBriefingResponse } from "@event-desk/contracts";
import express, { type Router } from "express";
import { parseEventId, validateBody } from "../../http/validate.js";
import type { ManualGenerationCoordinator } from "./manual-generation-coordinator.js";

/** Generate and Retry (A6, D13): synchronous; the body carries only the attendance baseline. */
export function generationRoutes(coordinator: Pick<ManualGenerationCoordinator, "generate">): Router {
  const router = express.Router();
  router.post("/events/:eventId/briefing-generations", async (req, res) => {
    const eventId = parseEventId(req.params.eventId);
    const body = validateBody(GenerateBriefingRequestSchema, req.body);
    const response: GenerateBriefingResponse = {
      incomingPreview: await coordinator.generate(eventId, body.baseAttendanceRevision),
    };
    res.status(201).json(response);
  });
  return router;
}
```

`apps/event-api/src/compose.ts`:
- Add `ids?: IdGenerator` to `ComposeOptions`, defaulting to `uuidV7IdGenerator`.
- After `changes` is created:

```ts
  const generation = new BriefingGenerationService({
    uow,
    gateway: new TcpAiGatewayClient(config.gateway, logger),
    ids,
    clock,
    changes,
    logger,
  });
  const manualGeneration = new ManualGenerationCoordinator({
    generation,
    ids,
    clock,
    changes,
    timeoutMs: config.manualGenerationTimeoutMs,
  });
```

- Pass `activity: manualGeneration` to `EventViewService`, replacing `noGenerationActivity`.
- Add `generationRoutes(manualGeneration)` to the routes.
- Delete `modules/event/no-generation-activity.ts`; nothing else uses it.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm test:integration`
Expected: PASS for the new file and all existing ones. The existing suites compose the API with `integrationConfig()`, whose default Gateway port (1) is never dialled, because they never generate.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify && pnpm test:integration`
Expected: exit 0. `event-api-adapters-only-from-composition-root` holds: only `compose.ts` imports `TcpAiGatewayClient` and `uuidV7IdGenerator`.

```bash
git add apps/event-api/src
git commit -m "feat(event-api): POST /briefing-generations — synchronous manual generation into the incoming slot" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Web data layer — `generateBriefing`, `useGenerateBriefing` and the fake API's generation endpoint

**Files:**
- Modify: `apps/web/src/data/api/event-api.ts`, `apps/web/src/data/api/event-api.test.ts`
- Create: `apps/web/src/data/mutations/generation-cache.ts`, `apps/web/src/data/mutations/use-generate-briefing.ts`
- Modify: `apps/web/src/testing/fake-event-api.ts`
- Test: `apps/web/src/data/mutations/generation-cache.test.ts`, `apps/web/src/data/mutations/use-generate-briefing.test.tsx`

**Interfaces:**
- Consumes:
  - `apiClient`, `parseResponse`, `ApiError` (Plan 2B); `createQueryClient`, `MutationToastMeta`, `queryKeys` (Plan 2B);
  - from contracts: `GenerateBriefingRequest`, `GenerateBriefingResponse`, `GenerateBriefingResponseSchema`, `EventView`.
- Produces:
  - `GENERATION_REQUEST_TIMEOUT_MS = 75_000`. This exceeds the server's 60 s run deadline, so the browser never gives up before the server does.
  - `generateBriefing(eventId, body): Promise<GenerateBriefingResponse>`.
  - `applyGenerated(view: EventView, response: GenerateBriefingResponse): EventView`.
  - `useGenerateBriefing(eventId)`, a mutation with variables `GenerateBriefingRequest`:
    - toasts "Briefing generated", "Briefing was not generated: …", and for an unknown outcome "Could not confirm the generation. Checking for a new preview…";
    - on success it writes `incomingPreview` into the event cache;
    - on settle it always invalidates the event query, because a lost response may still have committed (F4).
  - `FakeEventApi` additions:
    - `generationReplies: GenerationReply[]`, with `GenerationReply = { kind: "preview"; preview?: BriefingView; delayMs?: number } | { kind: "error"; status: number; code: HttpErrorCode; message: string; retryAfterMs?: number }`;
    - `generationRequests: unknown[]`;
    - a `POST /api/events/:eventId/briefing-generations` handler that applies the baseline check (409), then the queued reply. The default reply is `buildBriefingView()`, stored as `view.incomingPreview`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/data/api/event-api.test.ts` (keep its existing helpers `failureOf`, `api`, `E101`):

```ts
describe("generateBriefing", () => {
  it("posts only the attendance baseline and returns the validated incoming preview", async () => {
    const { incomingPreview } = await generateBriefing(E101, { baseAttendanceRevision: 0 });
    expect(incomingPreview.trigger).toBe("manual");
    expect(api.generationRequests).toEqual([{ baseAttendanceRevision: 0 }]);
  });

  it("surfaces 504 AI_OUTCOME_UNKNOWN as an http ApiError with its code", async () => {
    api.generationReplies.push({ kind: "error", status: 504, code: "AI_OUTCOME_UNKNOWN", message: "Lost after sending." });
    expect(await failureOf(generateBriefing(E101, { baseAttendanceRevision: 0 }))).toMatchObject({
      kind: "http",
      status: 504,
      code: "AI_OUTCOME_UNKNOWN",
    });
  });
});
```

Add `generateBriefing` to that file's import from `./event-api`.

`apps/web/src/data/mutations/generation-cache.test.ts`:

```ts
import { buildBriefingView, buildSeedEventView } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import { applyGenerated } from "./generation-cache";

describe("applyGenerated", () => {
  it("puts the new preview in the incoming slot and leaves everything else alone", () => {
    const view = buildSeedEventView();
    const incomingPreview = buildBriefingView();
    const next = applyGenerated(view, { incomingPreview });
    expect(next.incomingPreview).toBe(incomingPreview);
    expect({ ...next, incomingPreview: null }).toEqual(view);
  });
});
```

`apps/web/src/data/mutations/use-generate-briefing.test.tsx`:

```tsx
import { EventIdSchema, type EventView } from "@event-desk/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { createQueryClient, type ToastMessage } from "../query-client";
import { queryKeys } from "../queries/query-keys";
import { useGenerateBriefing } from "./use-generate-briefing";

const E101 = EventIdSchema.parse("E101");

function setup() {
  const api = new FakeEventApi();
  mswServer.use(...api.handlers());
  const toasts: ToastMessage[] = [];
  const client = createQueryClient((toast) => toasts.push(toast));
  client.setQueryData<EventView>(queryKeys.event(E101), api.view);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useGenerateBriefing(E101), { wrapper });
  return { api, toasts, client, result };
}

describe("useGenerateBriefing", () => {
  it("writes the incoming preview into the event cache and toasts once", async () => {
    const { toasts, client, result } = setup();
    await act(() => result.current.mutateAsync({ baseAttendanceRevision: 0 }));
    await waitFor(() => {
      expect(client.getQueryData<EventView>(queryKeys.event(E101))?.incomingPreview?.trigger).toBe("manual");
    });
    expect(toasts).toEqual([{ type: "info", body: "Briefing generated" }]);
  });

  it("toasts the reason once on a known failure", async () => {
    const { api, toasts, result } = setup();
    api.generationReplies.push({ kind: "error", status: 502, code: "PROVIDER_REFUSED", message: "The AI model declined to write this briefing." });
    await act(async () => {
      await result.current.mutateAsync({ baseAttendanceRevision: 0 }).catch(() => undefined);
    });
    expect(toasts).toEqual([
      { type: "error", body: "Briefing was not generated: The AI model declined to write this briefing." },
    ]);
  });
});
```

Run: `pnpm exec vitest run --project web src/data`
Expected: FAIL on the missing `generateBriefing`, `./generation-cache` and `./use-generate-briefing`, and on the missing `api.generationRequests`.

- [ ] **Step 2: Implement the endpoint function, the cache merge and the hook**

Add to `apps/web/src/data/api/event-api.ts`:

```ts
/** Longer than the server's 60 s run deadline (MANUAL_GENERATION_TIMEOUT_MS), so the server answers first. */
export const GENERATION_REQUEST_TIMEOUT_MS = 75_000;

export async function generateBriefing(
  eventId: EventId,
  body: GenerateBriefingRequest,
): Promise<GenerateBriefingResponse> {
  const response = await apiClient.post<unknown>(`${eventPath(eventId)}/briefing-generations`, body, {
    timeout: GENERATION_REQUEST_TIMEOUT_MS,
  });
  return parseResponse(GenerateBriefingResponseSchema, response.data);
}
```

Extend the contracts import with `type GenerateBriefingRequest`, `type GenerateBriefingResponse` and `GenerateBriefingResponseSchema`.

`apps/web/src/data/mutations/generation-cache.ts`:

```ts
import type { EventView, GenerateBriefingResponse } from "@event-desk/contracts";

/** A manual result always lands in the incoming slot (F7); nothing else in the view changes. */
export function applyGenerated(view: EventView, response: GenerateBriefingResponse): EventView {
  return { ...view, incomingPreview: response.incomingPreview };
}
```

`apps/web/src/data/mutations/use-generate-briefing.ts`:

```ts
import type { EventId, EventView, GenerateBriefingRequest } from "@event-desk/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { generateBriefing } from "../api/event-api";
import { queryKeys } from "../queries/query-keys";
import { applyGenerated } from "./generation-cache";

/** Generate and Retry (A6): one synchronous call; never retried automatically (F4). */
export function useGenerateBriefing(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: GenerateBriefingRequest) => generateBriefing(eventId, body),
    meta: {
      successToast: "Briefing generated",
      errorToast: "Briefing was not generated",
      unknownOutcomeToast: "Could not confirm the generation. Checking for a new preview…",
    },
    onSuccess: (response) => {
      queryClient.setQueryData<EventView>(queryKeys.event(eventId), (view) =>
        view === undefined ? view : applyGenerated(view, response),
      );
    },
    // Always re-read: after a lost response the server may still have committed the result (F4).
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) }),
  });
}
```

- [ ] **Step 3: Extend the fake API**

In `apps/web/src/testing/fake-event-api.ts`:
- Import `buildBriefingView` from `@event-desk/contracts/testing`, plus `type BriefingView` and `GenerateBriefingRequestSchema` from contracts, and `delay` from `msw`.
- Add the type and the class members below, and add the handler to `handlers()`:

```ts
export type GenerationReply =
  | { kind: "preview"; preview?: BriefingView; delayMs?: number }
  | { kind: "error"; status: number; code: HttpErrorCode; message: string; retryAfterMs?: number };

  // in FakeEventApi:
  readonly generationRequests: unknown[] = [];
  readonly generationReplies: GenerationReply[] = [];

      // in handlers():
      http.post("/api/events/:eventId/briefing-generations", async ({ request }) => {
        const body: unknown = await request.json();
        this.generationRequests.push(body);
        const parsed = GenerateBriefingRequestSchema.safeParse(body);
        if (!parsed.success) return apiErrorResponse(400, "VALIDATION_FAILED", "Invalid generation body.");
        if (parsed.data.baseAttendanceRevision !== this.view.attendanceRevision) {
          return apiErrorResponse(409, "ATTENDANCE_CONFLICT", "Attendance was saved elsewhere since you loaded it. Reload, then generate again.");
        }
        const reply = this.generationReplies.shift() ?? { kind: "preview" };
        if (reply.kind === "error") {
          return HttpResponse.json(
            { error: { code: reply.code, message: reply.message, ...(reply.retryAfterMs === undefined ? {} : { retryAfterMs: reply.retryAfterMs }) } },
            { status: reply.status },
          );
        }
        if (reply.delayMs !== undefined) await delay(reply.delayMs);
        const incomingPreview = reply.preview ?? buildBriefingView();
        this.view = { ...this.view, incomingPreview };
        return HttpResponse.json({ incomingPreview }, { status: 201 });
      }),
```

The `apiErrorResponse` helper's `code` parameter already became `HttpErrorCode` in Task 1.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project web`
Expected: PASS, including every Plan 2B test.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0. `web-data-layer-has-no-ui` holds.

```bash
git add apps/web/src
git commit -m "feat(web): generateBriefing endpoint, useGenerateBriefing mutation and fake generation API" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Briefing panel — Generate/Retry, in-flight state, safe errors and the read-only incoming preview

**Files:**
- Create: `apps/web/src/features/briefing/generate-briefing-control.tsx`, `apps/web/src/features/briefing/briefing-preview.tsx`
- Modify: `apps/web/src/features/briefing/briefing-panel.tsx`, `apps/web/src/features/event/event-page.tsx` (pass `eventId` and `view`)
- Test: `apps/web/src/features/briefing/briefing-panel.test.tsx`

**Interfaces:**
- Consumes:
  - `useGenerateBriefing` (Task 9); `ApiError`, `describeApiError` (Plan 2B); `useUiStore().attendanceDirty` (Plan 2B); `ConfirmDialog` (Plan 2B);
  - from contracts: `EventView`, `BriefingView`, `HttpErrorCode`;
  - Astryx `Button`, `Banner`, `EmptyState`, `Heading`, `Text`, `VStack`, `HStack`.
- Produces:
  - `BriefingPanel({ eventId, view })`;
  - `GenerateBriefingControl({ eventId, view })` and `mayHaveBeenCharged(error: unknown): boolean`;
  - `BriefingPreview({ title, briefing })`.

**UI rules (F4 steps 1, 7, 8; T3 §11; F7 "Generation state in the UI"; README "Screen and interaction"):**
- **Button.** It reads "Generate briefing", or "Retry" after a failed attempt in this session.
  - It is disabled while attendance has unsaved changes. A polite status line explains why: "Save or discard your attendance changes before generating."
  - It is disabled while a generation runs, either this tab's mutation or another tab's (`view.generation.manual !== null`).
  - The status line reads "Generating briefing… This can take up to a minute." or "A briefing is being generated in another tab…".
- **Errors.** A failure shows an error banner titled "Briefing was not generated", with `describeApiError(error)`. That is the server's actionable sentence from Task 4, and it stays until the next attempt.
- **Retry confirmation.** Retry asks first when `mayHaveBeenCharged(error)` is true: the code is `AI_OUTCOME_UNKNOWN` or `DEADLINE_EXCEEDED`, or the client never got an answer (`ApiError.outcomeUnknown`).
  - Dialog title: "Generate again?".
  - Description: "The last attempt may have reached the AI provider and been charged. Check the briefing below first: generating again starts a new paid attempt."
  - Action: "Generate again".
- **Preview.** `incomingPreview` is shown read-only, titled "New preview (not yet reviewed)", with:
  - a provenance line: "Generated {time} · {model} · requested by you" (or "automatic");
  - "What happened": the overview, then the feedback summary;
  - Themes, Conflicts and "Suggested follow-ups", where each item ends with "(Sources: F05, F06)";
  - empty-section text: "No recurring themes identified." (F4), "No conflicting views identified." and "No follow-ups suggested.".
  - All text renders through React as plain text (S1-03).
- **No preview** shows the empty state: title "No briefing yet", description "Press Generate briefing to create one from the saved records."
- Selecting and editing the preview, and the saved and selected slots, are Plan 4. Freshness notices are Plan 4 as well.

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/briefing/briefing-panel.test.tsx`:

```tsx
import { RunIdSchema } from "@event-desk/contracts";
import { buildBriefingView } from "@event-desk/contracts/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";

let api: FakeEventApi;

beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

const panel = async () => within(await screen.findByRole("region", { name: "Briefing" }));
const generateButton = (region: Awaited<ReturnType<typeof panel>>) =>
  region.getByRole<HTMLButtonElement>("button", { name: /Generate briefing|Retry|Generating briefing/ });

describe("briefing panel", () => {
  it("shows the empty state before any briefing exists", async () => {
    renderApp();
    const region = await panel();
    expect(region.getByText("No briefing yet")).toBeTruthy();
    expect(region.getByText("Press Generate briefing to create one from the saved records.")).toBeTruthy();
  });

  it("F4-01: generates from the saved baseline and shows the incoming preview read-only", async () => {
    api.generationReplies.push({ kind: "preview", delayMs: 150 });
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    expect(await region.findByText("Generating briefing… This can take up to a minute.")).toBeTruthy();
    expect(generateButton(region).disabled).toBe(true);

    expect(await region.findByRole("heading", { name: "New preview (not yet reviewed)" })).toBeTruthy();
    expect(region.getByText("4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).")).toBeTruthy();
    expect(region.getByText(/Requests for more rest-break time\./)).toBeTruthy();
    expect(region.getAllByText(/\(Sources: F05, F06\)/).length).toBeGreaterThan(0);
    expect(region.getByText(/fixture-model · requested by you/)).toBeTruthy();
    expect(api.generationRequests).toEqual([{ baseAttendanceRevision: 0 }]);
    expect((await screen.findAllByText("Briefing generated")).length).toBeGreaterThan(0);
  });

  it("F4 step 1: is disabled while attendance has unsaved changes, and says why", async () => {
    const { user } = renderApp();
    const attendance = within(await screen.findByRole("region", { name: "Attendance" }));
    await user.selectOptions(attendance.getByRole("combobox", { name: "Chris" }), "attended");
    const region = await panel();
    expect(generateButton(region).disabled).toBe(true);
    expect(region.getByText("Save or discard your attendance changes before generating.")).toBeTruthy();
  });

  it("F4-06: explains a failure and retries straight away when the outcome is known", async () => {
    api.generationReplies.push({ kind: "error", status: 503, code: "GATEWAY_UNAVAILABLE", message: "The AI service is not reachable. Your saved work is unchanged; try again shortly." });
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    expect(await region.findByText("The AI service is not reachable. Your saved work is unchanged; try again shortly.")).toBeTruthy();
    await user.click(region.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(api.generationRequests).toHaveLength(2);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Review Focus 5: Retry after an unknown outcome asks first, because it may be charged again", async () => {
    api.generationReplies.push({ kind: "error", status: 504, code: "AI_OUTCOME_UNKNOWN", message: "The connection to the AI service was lost after the request was sent; the attempt may have been charged. Your saved work is unchanged." });
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    await user.click(await region.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Generate again?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.generationRequests).toHaveLength(1);

    await user.click(region.getByRole("button", { name: "Retry" }));
    await user.click(await screen.findByRole("button", { name: "Generate again" }));
    await waitFor(() => {
      expect(api.generationRequests).toHaveLength(2);
    });
  });

  it("shows a generation running in another tab and blocks a second one", async () => {
    api.view = {
      ...api.view,
      generation: { ...api.view.generation, manual: { runId: RunIdSchema.parse("manual:other-tab"), startedAt: "2026-10-04T10:00:00.000Z" } },
    };
    renderApp();
    const region = await panel();
    expect(await region.findByText("A briefing is being generated in another tab…")).toBeTruthy();
    expect(generateButton(region).disabled).toBe(true);
  });

  it("S1-03: renders model text inertly and says when no themes were found", async () => {
    const preview = buildBriefingView();
    api.view = {
      ...api.view,
      incomingPreview: {
        ...preview,
        content: {
          ...preview.content,
          themes: [],
          suggestions: [{ text: '<img src=x onerror="alert(1)"> **Check** the route.', sourceIds: preview.content.suggestions[1]?.sourceIds ?? [] }],
        },
      },
    };
    renderApp();
    const region = await panel();
    expect(await region.findByText("No recurring themes identified.")).toBeTruthy();
    expect(region.getByText(/<img src=x onerror="alert\(1\)"> \*\*Check\*\* the route\./)).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
```

Run: `pnpm exec vitest run --project web src/features/briefing`
Expected: FAIL, because the panel has no Generate button yet.

- [ ] **Step 2: Implement the control**

`apps/web/src/features/briefing/generate-briefing-control.tsx`:

```tsx
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { EventId, EventView, HttpErrorCode } from "@event-desk/contracts";
import { useState } from "react";
import { ApiError, describeApiError } from "../../data/http/api-error";
import { useGenerateBriefing } from "../../data/mutations/use-generate-briefing";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { useUiStore } from "../../state/ui-store";

/** The earlier attempt may have reached the provider (F8): Retry asks before paying again (T3 §11). */
const UNCERTAIN_CODES: ReadonlySet<HttpErrorCode> = new Set(["AI_OUTCOME_UNKNOWN", "DEADLINE_EXCEEDED"]);

export function mayHaveBeenCharged(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.outcomeUnknown || (error.code !== undefined && UNCERTAIN_CODES.has(error.code));
}

/** Generate and Retry are the same synchronous call (A6); attendance must be saved first (F4). */
export function GenerateBriefingControl({ eventId, view }: { eventId: EventId; view: EventView }) {
  const generation = useGenerateBriefing(eventId);
  const attendanceDirty = useUiStore((state) => state.attendanceDirty);
  const [confirmingRetry, setConfirmingRetry] = useState(false);

  const elsewhere = view.generation.manual !== null && !generation.isPending;
  const busy = generation.isPending || view.generation.manual !== null;
  const start = () => {
    generation.mutate({ baseAttendanceRevision: view.attendanceRevision });
  };
  const press = () => {
    if (generation.isError && mayHaveBeenCharged(generation.error)) setConfirmingRetry(true);
    else start();
  };

  return (
    <VStack gap={2}>
      <div>
        <Button
          variant="primary"
          label={busy ? "Generating briefing…" : generation.isError ? "Retry" : "Generate briefing"}
          isLoading={busy}
          isDisabled={busy || attendanceDirty}
          onClick={press}
        />
      </div>
      <div role="status" aria-live="polite">
        {busy ? (
          <Text>
            {elsewhere
              ? "A briefing is being generated in another tab…"
              : "Generating briefing… This can take up to a minute."}
          </Text>
        ) : attendanceDirty ? (
          <Text>Save or discard your attendance changes before generating.</Text>
        ) : null}
      </div>
      {generation.isError && !busy ? (
        <Banner status="error" title="Briefing was not generated" description={describeApiError(generation.error)} />
      ) : null}
      <ConfirmDialog
        isOpen={confirmingRetry}
        title="Generate again?"
        description="The last attempt may have reached the AI provider and been charged. Check the briefing below first: generating again starts a new paid attempt."
        actionLabel="Generate again"
        onCancel={() => {
          setConfirmingRetry(false);
        }}
        onConfirm={() => {
          setConfirmingRetry(false);
          start();
        }}
      />
    </VStack>
  );
}
```

If Astryx's `Button` hides its label while `isLoading`, the accessible name may change. The tests find the button by any of its three labels and read the in-flight state from the status line, so they hold either way.

- [ ] **Step 3: Implement the preview and the panel**

`apps/web/src/features/briefing/briefing-preview.tsx`:

```tsx
import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { BriefingView, EvidenceItem } from "@event-desk/contracts";

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function EvidenceText({ item }: { item: EvidenceItem }) {
  return (
    <Text>
      {item.text} <Text type="supporting">(Sources: {item.sourceIds.join(", ")})</Text>
    </Text>
  );
}

function EvidenceSection({ title, items, empty }: { title: string; items: readonly EvidenceItem[]; empty: string }) {
  return (
    <section aria-label={title}>
      <VStack gap={1}>
        <Heading level={4}>{title}</Heading>
        {items.length === 0 ? (
          <Text type="supporting">{empty}</Text>
        ) : (
          <ul>
            {items.map((item, index) => (
              <li key={`${title}-${String(index)}`}>
                <EvidenceText item={item} />
              </li>
            ))}
          </ul>
        )}
      </VStack>
    </section>
  );
}

/** A read-only briefing (F4): code-built overview, cited model text, rendered as plain text (S1). */
export function BriefingPreview({ title, briefing }: { title: string; briefing: BriefingView }) {
  const { content, provenance } = briefing;
  return (
    <article aria-label={title}>
      <VStack gap={3}>
        <Heading level={3}>{title}</Heading>
        <Text type="supporting">
          Generated {timeFormat.format(new Date(provenance.generatedAt))} · {provenance.model} ·{" "}
          {briefing.trigger === "manual" ? "requested by you" : "automatic"}
        </Text>
        <section aria-label="What happened">
          <VStack gap={1}>
            <Heading level={4}>What happened</Heading>
            <Text>{content.attendanceOverview}</Text>
            <EvidenceText item={content.feedbackSummary} />
          </VStack>
        </section>
        <EvidenceSection title="Themes" items={content.themes} empty="No recurring themes identified." />
        <EvidenceSection title="Conflicts" items={content.conflicts} empty="No conflicting views identified." />
        <EvidenceSection title="Suggested follow-ups" items={content.suggestions} empty="No follow-ups suggested." />
      </VStack>
    </article>
  );
}
```

Replace `apps/web/src/features/briefing/briefing-panel.tsx` with:

```tsx
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading } from "@astryxdesign/core/Text";
import type { EventId, EventView } from "@event-desk/contracts";
import { BriefingPreview } from "./briefing-preview";
import { GenerateBriefingControl } from "./generate-briefing-control";

/** Generate/Retry and the incoming preview (Plan 3B). Plan 4 adds select, edit, save and freshness. */
export function BriefingPanel({ eventId, view }: { eventId: EventId; view: EventView }) {
  return (
    <section aria-label="Briefing">
      <VStack gap={3}>
        <Heading level={2}>Briefing</Heading>
        <GenerateBriefingControl eventId={eventId} view={view} />
        {view.incomingPreview === null ? (
          <EmptyState
            isCompact
            headingLevel={3}
            title="No briefing yet"
            description="Press Generate briefing to create one from the saved records."
          />
        ) : (
          <BriefingPreview title="New preview (not yet reviewed)" briefing={view.incomingPreview} />
        )}
      </VStack>
    </section>
  );
}
```

`apps/web/src/features/event/event-page.tsx`: render `<BriefingPanel eventId={eventId} view={view} />`.

The time format uses `Intl` with the browser locale. The tests assert the model name and the trigger text, never the formatted time, so they do not depend on the machine's locale.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project web`, twice.
Expected: PASS both times, including the Plan 2B event-page heading-order test, which is still `["Attendance", "Feedback", "Briefing"]`: the preview's headings are levels 3 and 4.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0. `web-ui-uses-data-layer` holds: the components use only the hook and `api-error`.

```bash
git add apps/web/src
git commit -m "feat(web): Generate/Retry with confirmation after uncertain outcomes and a read-only incoming preview" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: End-to-end with the real Gateway, prompt v3 live check, and configuration docs

**Files:**
- Modify: `.env.example` (event API block: `MANUAL_GENERATION_TIMEOUT_MS`)

**Interfaces:**
- Consumes: everything above; the running `pnpm dev` stack (Gateway, event API, web); the user's `OPENAI_API_KEY` in `.env`.
- Produces: evidence that the whole path works against the real model. This step makes about three paid calls.

- [ ] **Step 1: Document the setting**

In `.env.example`, add after `MYSQL_QUERY_TIMEOUT_MS=5000`:

```bash
# Whole-run deadline for a manual Generate (5000-300000 ms); the Gateway answers before it
MANUAL_GENERATION_TIMEOUT_MS=60000
```

If the repository `.env` lacks it, it still defaults to 60000. Do not edit `.env`.

- [ ] **Step 2: Run the stack**

```bash
pnpm dev > <sdd-workspace>/dev.log 2>&1 &
```

Poll in a bounded loop (at most 30 s) until all three ports listen: 4100, 4000 and 5173.

- [ ] **Step 3: Generate through the same-origin proxy**

```bash
REV=$(curl -s http://localhost:5173/api/events/E101 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).attendanceRevision))')
curl -s -o /tmp/gen.json -w "%{http_code}\n" -X POST http://localhost:5173/api/events/E101/briefing-generations \
  -H "Content-Type: application/json" -H "Origin: http://localhost:5173" -d "{\"baseAttendanceRevision\":$REV}"
node -e 'const r=require("/tmp/gen.json"); const c=r.incomingPreview.content; console.log(c.attendanceOverview); console.log("themes", c.themes.map(t=>t.sourceIds.join("+")).join(" | ")); console.log("conflicts", c.conflicts.map(t=>t.sourceIds.join("+")).join(" | ")); console.log(r.incomingPreview.provenance.model, r.incomingPreview.provenance.promptVersion)'
curl -s http://localhost:5173/api/events/E101 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);console.log(v.incomingPreview?.provenance.generationId, v.generation.lastOutcome?.status, v.generation.manual)})'
```

Write `/tmp/gen.json` under the SDD workspace instead. Expected:
- `201`;
- the seed overview "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).";
- `promptVersion` `briefing.v3.2026-10-04`;
- the event read shows the same generation ID, `succeeded` and `manual: null`.

Also check the dev log:
- the Gateway logged `"outcome":"ok"`;
- the event API logged "briefing generated" with `runId`, `generationId`, `model` and `usage`;
- `grep -c "meeting point" dev.log` is `0` (no note text in logs, S1).

- [ ] **Step 4: Prompt v3 live check**

Run `pnpm smoke:live`, then `pnpm smoke:live --hostile`. Both must end with `Evidence rules: pass`. Answer the printed checklist in the report, with quotes, and in particular F4-11:
- F05/F06 form one rest-break theme;
- F07 appears only under Suggestions, never in a theme;
- neither disagreement (F01/F02, F03/F04) is repeated as a theme.

If F4-11 still fails on meaning, report it with the output. Do not change the prompt beyond Task 2's wording without a controller ruling.

- [ ] **Step 5: Stop the stack**

Kill `pnpm dev` and any child that is still listening, then confirm that ports 4100, 4000 and 5173 are free.

- [ ] **Step 6: Verify and commit**

Run: `pnpm format && pnpm verify && pnpm build && pnpm test:integration`
Expected: exit 0.

```bash
git add .env.example
git commit -m "docs: document MANUAL_GENERATION_TIMEOUT_MS" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Done when

- `pnpm verify`, `pnpm build` and `pnpm test:integration` pass.
- `POST /api/events/E101/briefing-generations` is complete:
  - it captures saved input (TX4) and calls the Gateway's interactive lane;
  - it validates against the captured snapshot, then commits into the incoming slot with the F7 rules (TX5), or records the failed run (TX6);
  - it maps every Gateway outcome to the documented HTTP code.
- Manual generation is single-flight per event and visible to other tabs. An abandoned request still commits.
- In the web app:
  - Generate is blocked while attendance is unsaved;
  - it shows "Generating briefing…" and the server's actionable error;
  - it confirms before a possibly-charged Retry;
  - it renders the incoming preview read-only and inert.
- Prompt v3 is live-checked with `pnpm smoke:live` (both modes), with the F4-11 checklist answered.
- HTTP responses can no longer carry batch-only codes, enforced by `HttpErrorCode`.
