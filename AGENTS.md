# Working agreements — Event Desk

These rules apply to every change in this repository, by people and by agents.

## Sources of truth

- `docs/project-brief.md` is authoritative. `docs/specs/` records confirmed decisions (D1–D16);
  treat them as settled. Propose a change to a spec explicitly; never silently diverge in code.
- `docs/adr/` explains why each decision was made. `docs/superpowers/plans/` holds the build plans.

## Commands

| Command                             | What it does                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                      | Install the workspace                                                                                                                                                                                                                                                                                                                                                   |
| `cp .env.example .env`              | First-time local configuration (local-only defaults for Docker Compose)                                                                                                                                                                                                                                                                                                 |
| `pnpm infra:up` / `pnpm infra:down` | Start/stop MySQL 8.4 and Redis 8 (Docker Compose)                                                                                                                                                                                                                                                                                                                       |
| `pnpm dev`                          | AI Gateway on 127.0.0.1:4100 (TCP, loopback), event API on http://127.0.0.1:4000 and the coordinator web app on http://localhost:5173 (Vite proxies `/api`, including the live-update stream, to the API — same origin, no CORS); the test feedback form is at `/events/E101/feedback`; backend logs are pretty-printed one line each (JSON in `start`, tests and e2e)  |
| `pnpm verify`                       | Prettier check, ESLint, type-check (`tsc -b` + `apps/web` + `e2e`), dependency-cruiser, unit tests: run before every commit                                                                                                                                                                                                                                             |
| `pnpm test`                         | Unit tests (Vitest)                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm build`                        | `tsc -b` for the Node packages, then the production web bundle (`apps/web/dist`)                                                                                                                                                                                                                                                                                        |
| `pnpm test:integration`             | Integration tests against `event_desk_test` and Redis DB 1 (needs `pnpm infra:up`)                                                                                                                                                                                                                                                                                      |
| `pnpm e2e`                          | Resets `event_desk_test` and Redis DB 2, then runs the Playwright specs (F6 walkthrough; F7 feedback form to one automatic briefing, with a 2 s batch window) on its own ports (Gateway 4199, API 4010, web 5183). Needs `pnpm infra:up` and Chromium (`pnpm --filter @event-desk/e2e exec playwright install chromium`); do not run it alongside the integration tests |
| `pnpm feedback:simulate`            | Posts test feedback notes to the running event API (`--count 5 --interval-ms 200 [--text-file notes.txt]`); with the default 3 s window a burst becomes one automatic briefing (one paid call with a real key)                                                                                                                                                          |
| `pnpm smoke:live`                   | Manual real-model check through the running Gateway (needs `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env`); `--hostile` adds an injection note. Never in CI                                                                                                                                                                                                              |
| `pnpm arch`                         | Architecture rules only                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm db:reset`                     | Explicit reset with the event API stopped: recreates `event_desk`, deletes `event-desk:*` and `bull:briefing-batch:*` keys; the next start reseeds E101                                                                                                                                                                                                                 |

Only document a command once it exists.

## Dependencies

- Every new production dependency needs the user's confirmation before it is installed.
  New dev tooling also needs confirmation unless an approved plan already lists it.
- Pin exact versions (no `^` or `~`) and commit `pnpm-lock.yaml`.
- pnpm refuses versions published less than 8 hours ago (`minimumReleaseAge: 480`). Wait it out, or add a
  temporary exact-version `minimumReleaseAgeExclude` entry and remove it once the version has aged.

## Code

- TypeScript strict everywhere; no `any`, no non-null assertions, no string throws.
- Contract-first: boundary shapes are Zod schemas in `packages/contracts`; infer types from them and
  never hand-write a duplicate DTO.
- Layering (event-api): http → controllers → services → ports ← repositories/integrations.
  Services import ports, never adapters. Domain rules are pure functions in `domain/` or `contracts`.
- Exhaustive `switch` over unions with `assertNever` in the `default` branch.
- Kebab-case file and folder names. Multiple related React components may share a file.
- Feedback text is untrusted input everywhere: render it as plain text, never interpolate it into
  instructions, never log it.
- Secrets come only from environment variables and never reach logs, the browser or the repository.
  Only `apps/ai-gateway` may hold the OpenAI key or import `openai` / `@openai/agents`.

## Tests

- Test-first for domain rules and services. Every bug fix starts with a failing test.
- Unit tests sit beside the code (`*.test.ts`). Integration tests use `event_desk_test` and Redis DB 1.
- The live model is never called in CI; `pnpm smoke:live` (Plan 3) is a manual check.

## Git

- Conventional commit subjects (`feat(contracts): …`, `fix(event-api): …`, `chore: …`).
- Never commit `.env`, credentials or generated `dist/` output.
