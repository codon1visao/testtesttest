# Failure checks and results

[README](../README.md) · [AI generation (F4)](specs/04-ai-briefing-generation.md) · [Briefing editor (F5)](specs/05-briefing-editor.md) · [AI Gateway (F8)](specs/09-ai-gateway.md)

The brief asks for the checks and their actual results, including a reproducible generation failure
and a reproducible save failure. This page covers both twice:

- **Automated checks** use a stand-in Gateway, or a forced database condition, and run on every
  commit in CI.
- **Manual checks** use a local switch, such as stopping a service or blanking the API key. No code
  change is needed.

## Automated checks

**Run on 2026-10-05 against commit `44ae013`. All passed.**

| Suite                 | Files                                                                                          | Result       |
| --------------------- | ---------------------------------------------------------------------------------------------- | ------------ |
| API integration       | `generation-api.int.test.ts`, `briefing-api.int.test.ts`, `attendance.int.test.ts`             | 47/47 passed |
| Web unit (API faked)  | `briefing-panel.test.tsx`, `briefing-editor.test.tsx`, `attendance-panel.test.tsx`             | 98/98 passed |

The integration tests run the event API against real MySQL (`event_desk_test`) and Redis (DB 1).
The AI Gateway is replaced by a fake that can succeed, fail, drop the connection or break the
rules. The web tests use MSW in place of the API.

### Generation failures

From [`generation-api.int.test.ts`](../apps/event-api/src/modules/generation/generation-api.int.test.ts):

| Check                                                                                            | Expected result                                                                | Actual |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------ |
| F8-06: an unreachable Gateway is an immediate 503 GATEWAY_UNAVAILABLE                            | `503 GATEWAY_UNAVAILABLE` at once; nothing stored                              | Passed |
| Review Focus 5 / F8-07: a dropped connection is 504 AI_OUTCOME_UNKNOWN and keeps the existing preview | `504 AI_OUTCOME_UNKNOWN`; the existing preview is unchanged                    | Passed |
| Review Focus 4 / F4-04 / F4-12: an invalid candidate is never stored                             | A result that cites a note outside its input is rejected whole; nothing stored | Passed |
| F8-09: a provider rate limit is 429 PROVIDER_COOLDOWN with the wait                              | `429 PROVIDER_COOLDOWN` with `retryAfterMs`                                    | Passed |
| A rate limit starts a cooldown that blocks the next Generate before any paid call, across a restart | The next Generate is refused without calling the Gateway, even after a restart | Passed |
| The daily total stops manual Generate with 429 DAILY_LIMIT_REACHED and no Gateway call           | `429 DAILY_LIMIT_REACHED`; no Gateway call                                     | Passed |

From [`briefing-panel.test.tsx`](../apps/web/src/features/briefing/briefing-panel.test.tsx):

| Check                                                                                      | Expected result                                                  | Actual |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------ |
| F4-06: explains a failure and retries straight away when the outcome is known              | The failure is shown in words; Retry is offered                  | Passed |
| Review Focus 5: Retry after an unknown outcome asks first, because it may be charged again | Retry asks for confirmation before another paid attempt          | Passed |
| F8: Retry after a DEADLINE_EXCEEDED 504 asks first too                                     | The same confirmation                                            | Passed |
| Titles a lost response as unconfirmed, not as a failure                                    | The page says the outcome is unconfirmed, not that it failed     | Passed |

### Save failures

From [`briefing-api.int.test.ts`](../apps/event-api/src/modules/briefing/briefing-api.int.test.ts) and [`attendance.int.test.ts`](../apps/event-api/src/modules/attendance/attendance.int.test.ts):

| Check                                                                                                            | Expected result                                                         | Actual |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| Review Focus 1 / F5-06 / F6-11: a stale revision is rejected and changes nothing                                 | `409 BRIEFING_CONFLICT`; the saved briefing is unchanged                | Passed |
| Review Focus 2 / F5-03 / F5-11: source IDs, evidence objects or provenance in the body are rejected with nothing written | `400`; nothing written                                                  | Passed |
| F5-04: a wrong item count is CONTENT_INVALID on that section; blank text is 400                                  | `CONTENT_INVALID` naming the section; blank text is `400`               | Passed |
| F5-13: a corrupt stored reference is REFERENCE_INVALID and nothing is saved                                      | `REFERENCE_INVALID`; nothing saved                                      | Passed |
| Rejects a stale base revision with ATTENDANCE_CONFLICT                                                           | `409 ATTENDANCE_CONFLICT`                                               | Passed |
| T4-04: two concurrent saves from the same revision: one wins, one conflicts, no partial rows                     | One `200`, one `409`; no partial rows                                   | Passed |
| Answers 503 STORE_UNAVAILABLE while the event row stays locked, then saves once it is free                       | `503 STORE_UNAVAILABLE` within the query timeout; a later save succeeds | Passed |

From [`briefing-editor.test.tsx`](../apps/web/src/features/briefing/briefing-editor.test.tsx) and [`attendance-panel.test.tsx`](../apps/web/src/features/attendance/attendance-panel.test.tsx):

| Check                                                                              | Expected result                                          | Actual |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------- | ------ |
| Spec 05 save failed: Retry save sends the kept draft again                         | The draft is kept; **Retry save** resends it             | Passed |
| Review Focus 1 / F5-06: a save after another tab saved is a conflict that keeps the draft | A conflict notice is shown; the draft is kept            | Passed |
| Spec 05 revision conflict: shows the latest saved briefing for review and keeps the draft | The latest saved version can be reviewed; the draft is kept | Passed |
| F2-08: keeps the selections and explains a failed save                             | The attendance draft is kept; the failure is explained   | Passed |
| Explains a conflict, keeps the draft, and reloads only after confirmation          | No silent overwrite in either direction                  | Passed |

### Run them again

With `pnpm infra:up` running:

```bash
pnpm --filter @event-desk/event-api exec vitest run --config vitest.integration.config.ts src/modules/generation/generation-api.int.test.ts src/modules/briefing/briefing-api.int.test.ts src/modules/attendance/attendance.int.test.ts
```

```bash
pnpm --filter @event-desk/web exec vitest run src/features/briefing/briefing-panel.test.tsx src/features/briefing/briefing-editor.test.tsx src/features/attendance/attendance-panel.test.tsx
```

`pnpm test:integration` and `pnpm test` run the full suites, including these files.

## Manual checks with a local switch

These steps reproduce the same failures in the running app. None of them sends a request to
OpenAI, so none costs anything. Each one lists the result it should produce; they were not run for
the results recorded above.

### Generation failure A: the AI Gateway is not running

1. Stop `pnpm dev`, then start only the event API and the web app:

   ```bash
   pnpm --parallel --filter @event-desk/event-api --filter @event-desk/web dev
   ```

2. Open http://localhost:5173 and click **Generate**.
3. **Expected:** the request fails at once with `503 GATEWAY_UNAVAILABLE`, and the page explains it
   in words. The saved briefing and any previews are unchanged.
4. Stop it and run `pnpm dev` again to restore the Gateway.

### Generation failure B: no OpenAI key

Variables set in the shell take priority over `.env`, and a blank key turns the provider off.

1. Stop `pnpm dev`, then start it with a blank key:

   ```bash
   OPENAI_API_KEY= pnpm dev
   ```

2. Click **Generate**.
3. **Expected:** `503 PROVIDER_NOT_CONFIGURED`, explained on the page, with all content unchanged.
4. Restart with `pnpm dev` to use the key in `.env` again.

### Save failure A: a conflict between two tabs

1. Open the event in two tabs and start editing the briefing in both.
2. Save in the first tab, then save in the second.
3. **Expected:** the second tab gets `409 BRIEFING_CONFLICT`. Its draft is kept, and it offers the
   latest saved briefing for review. Nothing is overwritten silently.

Attendance works the same way: change it in both tabs and save twice. The second save gets
`409 ATTENDANCE_CONFLICT`.

### Save failure B: the database is down

1. Edit the briefing or attendance, but don't save yet.
2. Stop MySQL:

   ```bash
   docker compose stop mysql
   ```

3. Click **Save**.
4. **Expected:** `503 STORE_UNAVAILABLE`. The draft is kept, and the briefing editor offers **Retry
   save**.
5. Start MySQL again:

   ```bash
   docker compose start mysql
   ```

6. Click **Retry save**. **Expected:** the save succeeds.

To test a briefing save, a briefing must already be on screen. With a real key in `.env`, creating
the first one costs one paid Generate. An attendance save needs no briefing and costs nothing.
