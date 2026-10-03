# Event Desk — Plan 2: Event API Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/event-api` up to a working, tested HTTP API for the seeded E101 event. It covers the T4 schema and migration, seed-once and explicit reset (F1), the cached event read with briefing freshness (F1, F3, T3 §7), and attendance saves with conflict detection (F2).

**Architecture:** Express 5 controllers → application services → ports (`UnitOfWork`, `EventViewCache`, `ChangeNotifier`, `GenerationActivity`, `HealthProbe`, `Clock`) ← adapters (TypeORM/MySQL repositories, Redis cache, health probes). Every write is one InnoDB transaction that locks the event row first and runs cache flushes only after commit. The event read is served from a versioned Redis cache that every write flushes, and MySQL stays authoritative. `compose.ts` is the explicit composition root; `main.ts` only starts and stops it.

**Tech Stack:** Node 24, TypeScript 6.0.3, Express 5.2.1, TypeORM 1.1.1 (`EntitySchema`, hand-written SQL migration) + mysql2 3.24.5, ioredis 5.11.1, pino 10.4.0, Zod 4 via `@event-desk/contracts`, Vitest 5 + Supertest 7.3.1, MySQL 8.4 and Redis 8 from Docker Compose.

**Spec:** [docs/specs/README.md](../../specs/README.md), [F1](../../specs/01-event-and-persistence.md), [F2](../../specs/02-attendance.md), [F3](../../specs/03-feedback-and-sources.md), [S1](../../specs/08-openai-security.md) (origin/host/JSON rules), [T3](../../specs/12-architecture-and-repository.md) §5, §7, §10, §11, §13, [T4](../../specs/13-data-model-and-transactions.md) (schema, TX1–TX3, code shape). Plan 1 delivered `@event-desk/contracts`; its carry-forward items for Plan 2 are folded in below.

---

## Plan series (updated)

| Plan | Scope | Status |
| --- | --- | --- |
| 1 — Foundation | Workspace, contracts, Compose, CI, ADRs, spikes | Done (merged) |
| **2 — Event API core (this plan)** | event-api: schema, seed/reset, cached event read, attendance save, health, architecture rules for the app | — |
| 2B — Coordinator web shell | `apps/web`: event page with attendance and feedback panels on this API, using the Astryx recipe from `docs/spikes/astryx-vite.md` | after 2 |
| 3 — AI generation | tcp-rpc, ai-gateway, manual generation | after 2B |
| 4 — Review and save | F5/F6, Playwright walkthrough | after 3 |
| 5 — Automatic batches | feedback submission, BullMQ, SSE, priority, budget | after 4 |
| 6 — Hand-in | README | last |

The web shell is split into its own plan so this one stays reviewable. Plan 2 is complete without it: every behaviour is exercised through HTTP integration tests.

## Before you start

- Branch from `main`: `git switch -c feat/event-api-core main`.
- `pnpm infra:up` must report MySQL and Redis healthy. Integration tests use the `event_desk_test` database and Redis DB 1 only.
- Run `cp .env.example .env` once Task 1 has created `.env.example`. `.env` is git-ignored.

## Global Constraints

- All Plan 1 constraints still apply. In short:
  - TypeScript strict; no `any`, no non-null assertions, no string throws.
  - Exhaustive switches use `assertNever`.
  - Exact version pins, kebab-case file names.
  - Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Layering (T3 §11): `http → controllers → services → ports ← repositories/integrations → persistence`. Services import ports, never adapters. Only `compose.ts` wires adapters. dependency-cruiser enforces this (Task 2).
- Every write is one InnoDB transaction that begins by locking the event row (`SELECT … FOR UPDATE`). Revision checks happen inside the lock. No transaction stays open across a network call. Redis work runs only after commit, through `afterCommit` (T4 §6).
- Counts and freshness are never stored. They are derived from rows: `deriveAttendanceCounts`, `computeFreshness` (T4 §5).
- MySQL is authoritative. The cache key scheme is `event-desk:cache:event:{id}:ver` and `…:v{ver}`. A flush is `INCR ver` then `DEL v{old}`. If Redis is down, read MySQL. If a flush fails, bypass the cache until a flush succeeds (T3 §7).
- Never reseed on a read or connection failure. Seeding happens only when the `E101` row is absent (TX1). Reset is a local script that refuses to run while `/api/health` answers. It drops and recreates only `event_desk` (or `event_desk_test`). It deletes only Redis keys under `event-desk:` and `bull:briefing-batch:`. Never `FLUSHALL` or `FLUSHDB` (F1, T3 §13).
- The API binds to loopback only. Mutations must be `Content-Type: application/json`. Cross-origin mutations are rejected, and unknown `Host` names are rejected (S1).
- Errors use the contracts envelope `{ error: { code, message, field?, retryAfterMs? } }` and `ERROR_HTTP_STATUS`. 5xx responses never include stacks or SQL.
- Logs carry no raw feedback text, SQL parameters or secrets. pino redacts `err.parameters`, `err.query` and `err.driverError.sql`.
- Approving this plan approves exactly these dependencies, all from T2/T3 A12/A13:
  - `apps/event-api` production dependencies: `express` 5.2.1, `typeorm` 1.1.1, `mysql2` 3.24.5, `ioredis` 5.11.1, `pino` 10.4.0, `zod` 4.6.5, `@event-desk/contracts` `workspace:*`.
  - Dev dependencies: `supertest` 7.3.1, `@types/express` 5.0.6, `@types/supertest` 7.2.1.
  - `ioredis` is pinned to 5.11.1, the version BullMQ 6 is tested against (`docs/spikes/bullmq-window.md`).
  - If pnpm 11's minimum-release-age check refuses a pinned version, add an exact-version entry under the commented `minimumReleaseAgeExclude` block in `pnpm-workspace.yaml` and report it. Never pick a different version silently.

## Review Focus

1. **Redis unreachable** (Compose stopped, wrong port). The event page should still load from MySQL quickly, and `/api/health` should say `redis: "down"`. Pinned in Task 9 (`event-api.int.test.ts`: dead Redis URL, GET answers within 2 s).
2. **MySQL unavailable while the API runs.** Requests should fail fast with `503 STORE_UNAVAILABLE` JSON, with no hang, no stack and no reseed. Pinned in Task 5 (UoW on a destroyed data source) and Task 9 (GET after the store is closed).
3. **Malformed, non-JSON or oversized bodies, and unknown fields.** Expect `400 VALIDATION_FAILED`, never 500. Pinned in Task 3 (`http-policy.test.ts`) and Task 10 (attendance body with `counts`).
4. **The same roster in a different order, or an unchanged resend.** Accepted; an unchanged save keeps the revision and does not flush the cache. Pinned in Task 10.
5. **Event ID variants in the URL** (`e101`, `E101 `, `%00`). Expect `404 EVENT_NOT_FOUND`, not 500. Pinned in Task 3 (`validate.test.ts`) and Task 9.

---

## File structure

```text
.env.example                                   # Task 1
.dependency-cruiser.cjs                        # Task 2 (event-api layer rules)
.github/workflows/ci.yml                       # Task 4 (integration job)
packages/contracts/src/api/errors.ts           # Task 1 (+ NOT_FOUND)
packages/contracts/src/freshness.ts            # Task 1 (+ AttendanceChange type)
apps/event-api/
├─ package.json · tsconfig.json                # Task 1
├─ vitest.config.ts · vitest.shared.config.ts  # Task 1 (unit project)
├─ vitest.integration.config.ts                # Task 4
└─ src/
   ├─ main.ts · compose.ts · app.ts            # Tasks 9, 9, 3
   ├─ config/env.ts                            # Task 1
   ├─ shared/app-error.ts · logger.ts          # Task 1
   ├─ http/validate.ts                         # Task 3
   ├─ http/middleware/request-context.ts · host-guard.ts · origin-guard.ts
   │                  · require-json.ts · error-handler.ts · not-found.ts   # Task 3
   ├─ ports/health-probe.ts                    # Task 3
   ├─ ports/unit-of-work.ts                    # Task 5 (extended in Task 7)
   ├─ ports/event-view-cache.ts · change-notifier.ts · clock.ts            # Task 8
   ├─ ports/generation-activity.ts             # Task 9
   ├─ modules/health/health-controller.ts      # Task 3
   ├─ modules/briefing/briefing-views.ts       # Task 7
   ├─ modules/changes/cache-bypass.ts · in-process-change-notifier.ts
   │                  · event-change-publisher.ts                           # Task 8
   ├─ modules/event/domain/cache-ttl.ts        # Task 8
   ├─ modules/event/event-view-service.ts · event-controller.ts
   │                  · no-generation-activity.ts                           # Task 9
   ├─ modules/attendance/domain/diff-attendance.ts
   │                  · attendance-service.ts · attendance-controller.ts    # Task 10
   ├─ persistence/data-source.ts · migrations/1790985600000-initial-schema.ts
   │                  · entities/index.ts · entities/column-types.ts         # Task 4
   ├─ persistence/entities/event.entities.ts   # Task 5
   ├─ persistence/mysql-errors.ts · seed.ts · store-bootstrap.ts           # Task 6
   ├─ persistence/entities/generation.entities.ts · briefing-slot.entities.ts
   │                  · generation-outcome.entity.ts                        # Task 7
   ├─ persistence/mysql-health-probe.ts        # Task 9
   ├─ repositories/row-parsing.ts · store-errors.ts · event-repository.ts
   │                  · typeorm-unit-of-work.ts                             # Task 5
   ├─ repositories/briefing-mapping.ts · briefing-read-repository.ts
   │                  · outcome-read-repository.ts                          # Task 7
   ├─ integrations/redis-keys.ts · redis-client.ts · redis-event-view-cache.ts
   │                  · delete-keys-by-prefix.ts · system-clock.ts          # Task 8
   ├─ integrations/redis-health-probe.ts       # Task 9
   ├─ scripts/reset-store.ts · reset.ts        # Task 11
   └─ testing/test-config.ts · database.ts · sql-fixtures.ts
                      · integration-global-setup.ts                         # Task 4
              · redis.ts                        # Task 8
              · http.ts                         # Task 3
```

Unit tests sit beside the code as `*.test.ts`. Integration tests sit beside the code as `*.int.test.ts` and run only through `vitest.integration.config.ts` against `event_desk_test` and Redis DB 1. `src/testing/` holds test-only helpers. It is compiled like the rest of `src`, and the architecture rules exempt it.

---

### Task 1: event-api package, configuration, logger and AppError

**Files:**
- Create: `apps/event-api/package.json`, `apps/event-api/tsconfig.json`, `apps/event-api/vitest.shared.config.ts`, `apps/event-api/vitest.config.ts`
- Create: `apps/event-api/src/config/env.ts`, `apps/event-api/src/shared/app-error.ts`, `apps/event-api/src/shared/logger.ts`
- Create: `.env.example`
- Modify: `tsconfig.json` (reference), `vitest.config.ts` (projects), `eslint.config.js` (unused-args pattern, scripts console), `packages/contracts/src/api/errors.ts`, `packages/contracts/src/api/errors.test.ts`, `packages/contracts/src/freshness.ts`
- Test: `apps/event-api/src/config/env.test.ts`, `apps/event-api/src/shared/app-error.test.ts`, `apps/event-api/src/shared/logger.test.ts`

**Interfaces:**
- Consumes: `@event-desk/contracts` (`ErrorCode`, `ERROR_HTTP_STATUS`, `Freshness`).
- Produces:
  - `AppConfig` (`{ host, port, mysqlUrl, redisUrl, allowedOrigins: string[], allowedHosts: string[], eventViewCacheTtlMs, logLevel }`), `loadConfig(env?): AppConfig`, `ConfigError` (`problems: string[]`), `loadDotEnv(path: URL): void` (`config/env.ts`).
  - `AppError` (`code: ErrorCode`, `field: string | undefined`, `retryAfterMs: number | undefined`, standard `cause`), `AppErrorOptions` (`shared/app-error.ts`).
  - `createLogger(level, destination?): Logger`, `type Logger`, `type LogLevel`, `REDACTED_PATHS` (`shared/logger.ts`).
  - Contracts: new error code `NOT_FOUND` (404, unknown API route); `type AttendanceChange = Freshness["attendanceChanges"][number]`.

- [ ] **Step 1: Extend the contracts (failing test first)**

In `packages/contracts/src/api/errors.test.ts`, add this row to the `it.each` table, after `["EVENT_NOT_FOUND", 404],`:

```ts
    ["NOT_FOUND", 404],
```

Run: `pnpm test`
Expected: FAIL. TypeScript accepts the row, but `ERROR_HTTP_STATUS["NOT_FOUND"]` is `undefined`.

In `packages/contracts/src/api/errors.ts`, add `"NOT_FOUND",` to `ERROR_CODES` directly after `"EVENT_NOT_FOUND",`. Add `NOT_FOUND: 404,` to `ERROR_HTTP_STATUS` directly after `EVENT_NOT_FOUND: 404,`.

In `packages/contracts/src/freshness.ts`, add after the `Freshness` type:

```ts
/** One member whose saved status differs from a snapshot (also the shape of an attendance diff). */
export type AttendanceChange = Freshness["attendanceChanges"][number];
```

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 2: Create the package**

`apps/event-api/package.json`:

```json
{
  "name": "@event-desk/event-api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --conditions=@event-desk/source src/main.ts",
    "start": "node dist/main.js",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "db:reset": "tsx --conditions=@event-desk/source src/scripts/reset.ts"
  },
  "dependencies": {
    "@event-desk/contracts": "workspace:*",
    "express": "5.2.1",
    "ioredis": "5.11.1",
    "mysql2": "3.24.5",
    "pino": "10.4.0",
    "typeorm": "1.1.1",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@types/express": "5.0.6",
    "@types/supertest": "7.2.1",
    "supertest": "7.3.1"
  }
}
```

The `dev`, `test:integration` and `db:reset` scripts point at files that Tasks 4, 9 and 11 create. Nothing runs them before then.

`apps/event-api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/tsconfig.tsbuildinfo",
    "types": ["node"]
  },
  "include": ["src"],
  "references": [{ "path": "../../packages/contracts" }]
}
```

`apps/event-api/vitest.shared.config.ts` (Vitest inlines the workspace package and must resolve its TypeScript source through the custom condition):

```ts
const conditions = ["@event-desk/source", "module", "node", "development|production"];

/** Resolve workspace packages to their TypeScript source in tests (same condition as tsc and tsx). */
export const workspaceSourceResolution = {
  resolve: { conditions },
  ssr: { resolve: { conditions } },
};
```

`apps/event-api/vitest.config.ts`:

```ts
import { defineProject } from "vitest/config";
import { workspaceSourceResolution } from "./vitest.shared.config";

export default defineProject({
  ...workspaceSourceResolution,
  test: {
    name: "event-api",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.int.test.ts"],
    environment: "node",
  },
});
```

Root `tsconfig.json`: replace its content with

```json
{
  "files": [],
  "references": [{ "path": "packages/contracts" }, { "path": "apps/event-api" }]
}
```

Root `vitest.config.ts`: change `projects: ["packages/*"]` to `projects: ["packages/*", "apps/*"]`.

`eslint.config.js`:
- In the main `rules` object, add `"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],`.
- Add this object as the last array element:

```js
  {
    files: ["apps/*/src/scripts/**"],
    rules: { "no-console": "off" },
  },
```

Run: `pnpm install`
Expected: dependencies installed. If pnpm 11 refuses a version for release age, follow the Global Constraints rule.

- [ ] **Step 3: Write the failing tests**

`apps/event-api/src/config/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./env.js";

const MYSQL_URL = "mysql://event_desk:secret-pw@127.0.0.1:3306/event_desk";

describe("loadConfig", () => {
  it("applies the documented defaults (T3 §13)", () => {
    expect(loadConfig({ MYSQL_URL })).toEqual({
      host: "127.0.0.1",
      port: 4000,
      mysqlUrl: MYSQL_URL,
      redisUrl: "redis://127.0.0.1:6379/0",
      allowedOrigins: ["http://localhost:5173"],
      allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
      eventViewCacheTtlMs: 30_000,
      logLevel: "info",
    });
  });

  it("parses comma-separated lists and numbers", () => {
    const config = loadConfig({
      MYSQL_URL,
      PORT: "4100",
      ALLOWED_ORIGINS: "http://localhost:5173, http://127.0.0.1:5173",
      EVENT_VIEW_CACHE_TTL_MS: "0",
    });
    expect(config.port).toBe(4100);
    expect(config.allowedOrigins).toEqual(["http://localhost:5173", "http://127.0.0.1:5173"]);
    expect(config.eventViewCacheTtlMs).toBe(0);
  });

  it("refuses to bind anywhere but loopback (S1)", () => {
    expect(() => loadConfig({ MYSQL_URL, HOST: "0.0.0.0" })).toThrow(ConfigError);
  });

  it("names every invalid variable without echoing secret values", () => {
    try {
      loadConfig({ MYSQL_URL: "postgres://user:secret-pw@db/x", PORT: "70000" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).toContain("MYSQL_URL");
      expect(message).toContain("PORT");
      expect(message).not.toContain("secret-pw");
    }
  });

  it("requires MYSQL_URL", () => {
    expect(() => loadConfig({})).toThrow(/MYSQL_URL/);
  });
});
```

`apps/event-api/src/shared/app-error.test.ts`:

```ts
import { ERROR_HTTP_STATUS } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { AppError } from "./app-error.js";

describe("AppError", () => {
  it("carries a contracts error code, an optional field and a cause", () => {
    const cause = new Error("driver detail");
    const error = new AppError("ATTENDANCE_CONFLICT", "Reload to continue.", { field: "members", cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AppError");
    expect(error.code).toBe("ATTENDANCE_CONFLICT");
    expect(ERROR_HTTP_STATUS[error.code]).toBe(409);
    expect(error.field).toBe("members");
    expect(error.retryAfterMs).toBeUndefined();
    expect(error.cause).toBe(cause);
  });

  it("supports retryAfterMs for cooldown errors", () => {
    expect(new AppError("PROVIDER_COOLDOWN", "Wait.", { retryAfterMs: 1500 }).retryAfterMs).toBe(1500);
  });
});
```

`apps/event-api/src/shared/logger.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

function captureLogger() {
  const lines: string[] = [];
  const logger = createLogger("info", { write: (chunk: string) => void lines.push(chunk) });
  return { logger, lines };
}

describe("createLogger", () => {
  it("redacts SQL parameters and queries from logged errors (S1: no raw notes in logs)", () => {
    const { logger, lines } = captureLogger();
    const error = Object.assign(new Error("insert failed"), {
      query: "INSERT INTO feedback_notes …",
      parameters: ["Secret feedback text"],
    });
    logger.error({ err: error }, "write failed");
    const output = lines.join("");
    expect(output).toContain("write failed");
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("Secret feedback text");
    expect(output).not.toContain("INSERT INTO");
  });

  it("tags every line with the service name", () => {
    const { logger, lines } = captureLogger();
    logger.info("hello");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ service: "event-api", msg: "hello" });
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `pnpm test`
Expected: FAIL. `Failed to resolve import "./env.js"`, `"./app-error.js"` and `"./logger.js"`.

- [ ] **Step 5: Implement**

`apps/event-api/src/config/env.ts`:

```ts
import { z } from "zod";
import type { LogLevel } from "../shared/logger.js";

const csv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    );

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const satisfies readonly LogLevel[];

const EnvSchema = z.object({
  HOST: z.enum(["127.0.0.1", "::1", "localhost"], { error: "HOST must be a loopback address" }).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  MYSQL_URL: z.url({ protocol: /^mysql$/, error: "must be a mysql:// URL" }),
  REDIS_URL: z.url({ protocol: /^redis$/, error: "must be a redis:// URL" }).default("redis://127.0.0.1:6379/0"),
  ALLOWED_ORIGINS: csv("http://localhost:5173"),
  ALLOWED_HOSTS: csv("localhost,127.0.0.1,[::1]"),
  EVENT_VIEW_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(30_000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

export interface AppConfig {
  host: string;
  port: number;
  mysqlUrl: string;
  redisUrl: string;
  allowedOrigins: string[];
  allowedHosts: string[];
  eventViewCacheTtlMs: number;
  logLevel: LogLevel;
}

/** Invalid configuration. The message names variables and problems, never their values. */
export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid event-api configuration:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`),
    );
  }
  const e = result.data;
  return {
    host: e.HOST,
    port: e.PORT,
    mysqlUrl: e.MYSQL_URL,
    redisUrl: e.REDIS_URL,
    allowedOrigins: e.ALLOWED_ORIGINS,
    allowedHosts: e.ALLOWED_HOSTS,
    eventViewCacheTtlMs: e.EVENT_VIEW_CACHE_TTL_MS,
    logLevel: e.LOG_LEVEL,
  };
}

/** Loads the repository's `.env` if it exists. Variables already set in the environment win. */
export function loadDotEnv(path: URL): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}
```

`apps/event-api/src/shared/app-error.ts`:

```ts
import type { ErrorCode } from "@event-desk/contracts";

export interface AppErrorOptions {
  field?: string;
  retryAfterMs?: number;
  cause?: unknown;
}

/** The only error type the application throws on purpose; the HTTP layer maps `code` to a status. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly field: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.field = options.field;
    this.retryAfterMs = options.retryAfterMs;
  }
}
```

`apps/event-api/src/shared/logger.ts`:

```ts
import { type DestinationStream, type Logger, pino } from "pino";

export type { Logger };

/** Owned here (not in config/) because shared/ is a leaf that imports nothing else in the app. */
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

/** Error properties that can carry SQL text or feedback content (S1: never log raw notes). */
export const REDACTED_PATHS = [
  "err.query",
  "err.parameters",
  "err.driverError.sql",
  "err.cause.query",
  "err.cause.parameters",
  "err.cause.driverError.sql",
];

export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: "event-api" },
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}
```

`.env.example` (repository root):

```bash
# Copy to .env for local runs: cp .env.example .env
# Values are local-only defaults for the Docker Compose services (docker-compose.yml).

# Event API (binds to loopback only)
HOST=127.0.0.1
PORT=4000
MYSQL_URL=mysql://event_desk:event_desk_local@127.0.0.1:3306/event_desk
REDIS_URL=redis://127.0.0.1:6379/0
ALLOWED_ORIGINS=http://localhost:5173
ALLOWED_HOSTS=localhost,127.0.0.1,[::1]
EVENT_VIEW_CACHE_TTL_MS=30000
LOG_LEVEL=info

# Docker Compose overrides (optional): MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD, MYSQL_PORT, REDIS_PORT.
# MySQL creates its users and the event_desk_test database only on an EMPTY volume. After changing
# MYSQL_PASSWORD, recreate the volume: docker compose down -v && pnpm infra:up (this deletes local data).
```

Append to the root `.prettierignore`: a line `.env.example`. Prettier cannot parse it, and the file is hand-formatted.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS for `contracts` and `event-api` projects.

- [ ] **Step 7: Prove the source condition works in Vitest**

Run: `rm -rf packages/contracts/dist apps/event-api/dist && pnpm test`
Expected: PASS. `app-error.test.ts` imports `ERROR_HTTP_STATUS` at runtime. That only resolves without `dist/` if Vitest follows `@event-desk/source`. If it fails with `Failed to resolve entry for package "@event-desk/contracts"`, the `workspaceSourceResolution` keys do not match this Vite version. Fix them, still without adding a build step, and report the fix.

- [ ] **Step 8: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0. `tsc -b` now also builds `apps/event-api`.

```bash
git add packages/contracts apps/event-api .env.example .prettierignore tsconfig.json vitest.config.ts eslint.config.js pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(event-api): package, configuration, logger and AppError" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Architecture rules for event-api (with probes)

**Files:**
- Modify: `.dependency-cruiser.cjs`, root `package.json` (`arch` script)

**Interfaces:**
- Consumes: the existing rules from Plan 1 (constant `TESTS`, helper `npm(names)`).
- Produces: `pnpm arch` cruising `apps` and `packages`. It enforces T3 §11 layer direction for event-api. Later tasks must keep it green.

- [ ] **Step 1: Widen the arch script**

In root `package.json`, set:

```json
"arch": "depcruise apps packages --config .dependency-cruiser.cjs",
```

Run: `pnpm arch`
Expected: no violations (event-api contains only `config/` and `shared/`).

- [ ] **Step 2: Adjust two existing rules for test helpers**

In `.dependency-cruiser.cjs`:
- In rule `typeorm-only-in-persistence`, set `from.pathNot` to `"^apps/event-api/src/(persistence|repositories|scripts|testing)/"`.
- In rule `queue-and-redis-only-in-integrations`, set `from.pathNot` to `"^apps/event-api/src/(integrations|scripts|testing)/"`.

- [ ] **Step 3: Add the layer-direction rules**

Append these objects to the `forbidden` array:

```js
    {
      name: "event-api-application-not-to-http",
      comment: "Services, domain code, ports and adapters never depend on HTTP or controllers (T3 §11).",
      severity: "error",
      from: {
        path: "^apps/event-api/src/(modules|ports|repositories|integrations|persistence|shared)/",
        pathNot: ["-controller\\.ts$", TESTS],
      },
      to: { path: ["^apps/event-api/src/http/", "-controller\\.ts$", "^apps/event-api/src/app\\.ts$"] },
    },
    {
      name: "event-api-ports-are-abstract",
      comment: "Ports declare contracts only: contracts, domain types, shared types and other ports.",
      severity: "error",
      from: { path: "^apps/event-api/src/ports/", pathNot: TESTS },
      to: {
        pathNot: [
          "^apps/event-api/src/ports/",
          "^packages/contracts/",
          "/domain/",
          "^apps/event-api/src/shared/",
        ],
      },
    },
    {
      name: "event-api-adapters-not-to-application",
      comment: "Adapters implement ports; they never call services, controllers or the HTTP layer.",
      severity: "error",
      from: { path: "^apps/event-api/src/(repositories|integrations|persistence)/", pathNot: TESTS },
      to: { path: "^apps/event-api/src/(modules|http)/", pathNot: "/domain/" },
    },
    {
      name: "event-api-shared-is-leaf",
      comment: "shared/ holds cross-cutting primitives and depends on nothing else in the app.",
      severity: "error",
      from: { path: "^apps/event-api/src/shared/", pathNot: TESTS },
      to: {
        path: "^apps/event-api/src/(modules|ports|repositories|integrations|persistence|http|config|scripts)/",
      },
    },
    {
      name: "event-api-composition-root",
      comment: "Only main.ts and test helpers import the composition root.",
      severity: "error",
      from: {
        path: "^apps/event-api/src/",
        pathNot: ["^apps/event-api/src/main\\.ts$", "^apps/event-api/src/testing/", TESTS],
      },
      to: { path: "^apps/event-api/src/(main|compose)\\.ts$" },
    },
```

Run: `pnpm arch`
Expected: no violations.

- [ ] **Step 4: Probe every event-api rule**

Create these temporary files. Each is one or two import lines plus `export {};`. They exist only for this step.

| File | Content | Must trigger |
| --- | --- | --- |
| `apps/event-api/src/http/probe-http.ts` | `export {};` | (target only) |
| `apps/event-api/src/modules/probe/probe-service.ts` | `import "../../http/probe-http.js";`<br>`import "../../repositories/probe-repo.js";`<br>`export {};` | `event-api-application-not-to-http`, `services-use-ports` |
| `apps/event-api/src/repositories/probe-repo.ts` | `import "../modules/probe/probe-service.js";`<br>`export {};` | `event-api-adapters-not-to-application` |
| `apps/event-api/src/ports/probe-port.ts` | `import "../repositories/probe-repo.js";`<br>`export {};` | `event-api-ports-are-abstract` |
| `apps/event-api/src/shared/probe-shared.ts` | `import "../ports/probe-port.js";`<br>`export {};` | `event-api-shared-is-leaf` |
| `apps/event-api/src/compose.ts` | `export {};` | (target only) |
| `apps/event-api/src/modules/probe/probe-root.ts` | `import "../../compose.js";`<br>`export {};` | `event-api-composition-root` |
| `apps/event-api/src/modules/probe/probe-orm.ts` | `import "typeorm";`<br>`import "ioredis";`<br>`export {};` | `typeorm-only-in-persistence`, `queue-and-redis-only-in-integrations` |
| `apps/event-api/src/modules/probe/domain/probe-domain.ts` | `import "../probe-service.js";`<br>`import "node:fs";`<br>`export {};` | `domain-is-pure` (twice) |

`compose.ts` does not exist yet. You create it here only as a probe target, and you must delete it.

Run: `pnpm arch`
Expected: FAIL, listing each rule name from the table at least once. Copy the output into your report.

Delete exactly the files you created:

```bash
rm -r apps/event-api/src/modules/probe apps/event-api/src/http apps/event-api/src/repositories apps/event-api/src/ports apps/event-api/src/compose.ts apps/event-api/src/shared/probe-shared.ts
```

Before running that, check with `git status --short apps/event-api/src` that `http/`, `repositories/`, `ports/` and `modules/` contain only your probe files. In this task they hold nothing else.

Run: `pnpm arch`
Expected: no violations. `git status --short` shows only the two modified files.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add .dependency-cruiser.cjs package.json
git commit -m "chore(arch): enforce event-api layer direction and probe every rule" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: HTTP layer: policy middleware, errors, validation, health

**Files:**
- Create: `apps/event-api/src/app.ts`
- Create: `apps/event-api/src/http/validate.ts`
- Create: `apps/event-api/src/http/middleware/request-context.ts`, `host-guard.ts`, `origin-guard.ts`, `require-json.ts`, `error-handler.ts`, `not-found.ts`
- Create: `apps/event-api/src/ports/health-probe.ts`, `apps/event-api/src/modules/health/health-controller.ts`
- Create: `apps/event-api/src/testing/http.ts`
- Test: `apps/event-api/src/http/http-policy.test.ts`, `apps/event-api/src/http/validate.test.ts`, `apps/event-api/src/modules/health/health-controller.test.ts`

**Interfaces:**
- Consumes: `AppError` and `Logger`/`createLogger` (Task 1); contracts `ERROR_HTTP_STATUS`, `ApiErrorBodySchema`, `EventIdSchema`, `EventId`.
- Produces:
  - `createApp({ logger, policy: HttpPolicy, routes: readonly Router[] }): Express`, `HttpPolicy` (`{ allowedOrigins: readonly string[]; allowedHosts: readonly string[] }`) in `app.ts`. All routes are mounted under `/api`.
  - `validateBody(schema, body)`, `parseEventId(raw: string): EventId` (`http/validate.ts`).
  - `requestLogger(res, fallback): Logger` (`http/middleware/request-context.ts`).
  - `HealthProbe` (`{ isUp(): Promise<boolean> }`), `healthRoutes({ mysql, redis }): Router`. `GET /api/health` returns 200 `{ mysql: "up", redis: "up" | "down" }`, or 503 when MySQL is down.
  - Test helper `errorCodeOf(response): ErrorCode` (`testing/http.ts`).

- [ ] **Step 1: Write the failing tests**

`apps/event-api/src/testing/http.ts`:

```ts
import { ApiErrorBodySchema, type ErrorCode } from "@event-desk/contracts";

/** Parses a JSON error response through the contract, so tests never touch `any` bodies. */
export function errorCodeOf(response: { body: unknown }): ErrorCode {
  return ApiErrorBodySchema.parse(response.body).error.code;
}
```

`apps/event-api/src/http/http-policy.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../app.js";
import { AppError } from "../shared/app-error.js";
import { createLogger } from "../shared/logger.js";
import { errorCodeOf } from "../testing/http.js";
import { validateBody } from "./validate.js";

function buildApp() {
  const lines: string[] = [];
  const logger = createLogger("info", { write: (chunk: string) => void lines.push(chunk) });
  const routes = express.Router();
  routes.post("/echo", (req, res) => {
    res.json(validateBody(z.strictObject({ name: z.string() }), req.body));
  });
  routes.get("/boom", () => {
    throw new Error("database password is hunter2");
  });
  routes.get("/conflict", () => {
    throw new AppError("ATTENDANCE_CONFLICT", "Reload to continue.");
  });
  routes.get("/cooldown", () => {
    throw new AppError("PROVIDER_COOLDOWN", "Wait a moment.", { retryAfterMs: 1500 });
  });
  const app = createApp({
    logger,
    policy: { allowedOrigins: ["http://localhost:5173"], allowedHosts: ["127.0.0.1", "localhost"] },
    routes: [routes],
  });
  return { app, lines };
}

describe("HTTP policy", () => {
  it("accepts a same-origin JSON mutation", async () => {
    const { app } = buildApp();
    const res = await request(app).post("/api/echo").set("Origin", "http://localhost:5173").send({ name: "Bea" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "Bea" });
  });

  it("accepts a mutation without an Origin header (CLI and scripts)", async () => {
    const { app } = buildApp();
    expect((await request(app).post("/api/echo").send({ name: "Bea" })).status).toBe(200);
  });

  it("rejects cross-origin mutations (S1-09, S1-14)", async () => {
    const { app } = buildApp();
    const evil = await request(app).post("/api/echo").set("Origin", "http://evil.example").send({ name: "x" });
    expect(evil.status).toBe(403);
    expect(errorCodeOf(evil)).toBe("ORIGIN_REJECTED");
    const crossSite = await request(app).post("/api/echo").set("Sec-Fetch-Site", "cross-site").send({ name: "x" });
    expect(errorCodeOf(crossSite)).toBe("ORIGIN_REJECTED");
  });

  it("rejects unknown Host names (DNS rebinding)", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/conflict").set("Host", "attacker.example");
    expect(res.status).toBe(403);
    expect(errorCodeOf(res)).toBe("ORIGIN_REJECTED");
  });

  it("requires JSON for mutations", async () => {
    const { app } = buildApp();
    const res = await request(app).post("/api/echo").type("form").send("name=Bea");
    expect(res.status).toBe(400);
    expect(errorCodeOf(res)).toBe("VALIDATION_FAILED");
  });

  it("answers malformed and oversized JSON with 400, never 500", async () => {
    const { app } = buildApp();
    const malformed = await request(app).post("/api/echo").set("Content-Type", "application/json").send('{"name":');
    expect(malformed.status).toBe(400);
    expect(errorCodeOf(malformed)).toBe("VALIDATION_FAILED");
    const huge = await request(app).post("/api/echo").send({ name: "x".repeat(70_000) });
    expect(huge.status).toBe(400);
    expect(errorCodeOf(huge)).toBe("VALIDATION_FAILED");
  });

  it("rejects unknown fields through the strict schema", async () => {
    const { app } = buildApp();
    const res = await request(app).post("/api/echo").send({ name: "Bea", admin: true });
    expect(res.status).toBe(400);
    expect(errorCodeOf(res)).toBe("VALIDATION_FAILED");
  });

  it("maps AppError codes through ERROR_HTTP_STATUS and sets Retry-After", async () => {
    const { app } = buildApp();
    expect((await request(app).get("/api/conflict")).status).toBe(409);
    const cooldown = await request(app).get("/api/cooldown");
    expect(cooldown.status).toBe(429);
    expect(cooldown.get("Retry-After")).toBe("2");
    expect(cooldown.body).toEqual({
      error: { code: "PROVIDER_COOLDOWN", message: "Wait a moment.", retryAfterMs: 1500 },
    });
  });

  it("hides unexpected errors behind INTERNAL and logs them with the request ID", async () => {
    const { app, lines } = buildApp();
    const res = await request(app).get("/api/boom").set("X-Request-Id", "req-42");
    expect(res.status).toBe(500);
    expect(errorCodeOf(res)).toBe("INTERNAL");
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
    expect(JSON.stringify(res.body)).not.toContain("stack");
    expect(lines.join("")).toContain('"requestId":"req-42"');
  });

  it("answers unknown API routes with NOT_FOUND", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(errorCodeOf(res)).toBe("NOT_FOUND");
  });

  it("echoes a safe X-Request-Id and replaces an unsafe one", async () => {
    const { app } = buildApp();
    expect((await request(app).get("/api/conflict").set("X-Request-Id", "abc-123")).get("X-Request-Id")).toBe("abc-123");
    const replaced = (await request(app).get("/api/conflict").set("X-Request-Id", "bad id!")).get("X-Request-Id");
    expect(replaced).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

`apps/event-api/src/http/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "../shared/app-error.js";
import { parseEventId, validateBody } from "./validate.js";

describe("parseEventId", () => {
  it("accepts a well-formed ID", () => {
    expect(parseEventId("E101")).toBe("E101");
  });

  it.each(["e101", "E101 ", " E101", "\u0000", "../E101", "E1", ""])(
    "answers %j with EVENT_NOT_FOUND (binary-collation IDs)",
    (raw) => {
      expect(() => parseEventId(raw)).toThrow(AppError);
      try {
        parseEventId(raw);
      } catch (error) {
        expect((error as AppError).code).toBe("EVENT_NOT_FOUND");
      }
    },
  );
});

describe("validateBody", () => {
  const schema = z.strictObject({ members: z.array(z.strictObject({ id: z.string() })) });

  it("returns the parsed body", () => {
    expect(validateBody(schema, { members: [{ id: "M01" }] })).toEqual({ members: [{ id: "M01" }] });
  });

  it("reports the first failing field", () => {
    try {
      validateBody(schema, { members: [{ id: 7 }] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("VALIDATION_FAILED");
      expect((error as AppError).field).toBe("members.0.id");
    }
  });
});
```

`apps/event-api/src/modules/health/health-controller.test.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import type { HealthProbe } from "../../ports/health-probe.js";
import { createLogger } from "../../shared/logger.js";
import { healthRoutes } from "./health-controller.js";

const probe = (result: boolean | Error): HealthProbe => ({
  isUp: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
});

const appWith = (mysql: HealthProbe, redis: HealthProbe) =>
  createApp({
    logger: createLogger("silent"),
    policy: { allowedOrigins: [], allowedHosts: ["127.0.0.1"] },
    routes: [healthRoutes({ mysql, redis })],
  });

describe("GET /api/health", () => {
  it("reports both stores up", async () => {
    const res = await request(appWith(probe(true), probe(true))).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mysql: "up", redis: "up" });
    expect(res.get("Cache-Control")).toBe("no-store");
  });

  it("stays 200 when only Redis is down: the API still serves from MySQL", async () => {
    const res = await request(appWith(probe(true), probe(new Error("ECONNREFUSED")))).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mysql: "up", redis: "down" });
  });

  it("answers 503 when MySQL is down", async () => {
    const res = await request(appWith(probe(false), probe(true))).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ mysql: "down", redis: "up" });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test`
Expected: FAIL. `Failed to resolve import "../app.js"`, `"./validate.js"` and `"./health-controller.js"`.

- [ ] **Step 3: Implement the middleware**

`apps/event-api/src/http/middleware/request-context.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { RequestHandler, Response } from "express";
import type { Logger } from "../../shared/logger.js";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;
const requestLoggers = new WeakMap<Response, Logger>();

/** Assigns a request ID (echoed as X-Request-Id), a child logger, and logs one line per request. */
export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get("x-request-id");
    const requestId = incoming !== undefined && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    const log = logger.child({ requestId });
    const startedAt = performance.now();
    requestLoggers.set(res, log);
    res.setHeader("X-Request-Id", requestId);
    res.on("finish", () => {
      log.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        },
        "request completed",
      );
    });
    next();
  };
}

export function requestLogger(res: Response, fallback: Logger): Logger {
  return requestLoggers.get(res) ?? fallback;
}
```

`apps/event-api/src/http/middleware/host-guard.ts`:

```ts
import type { RequestHandler } from "express";
import { AppError } from "../../shared/app-error.js";

/** Rejects requests whose Host is not a configured name (DNS-rebinding defence, S1). Ports are ignored. */
export function hostGuard(allowedHosts: readonly string[]): RequestHandler {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  return (req, _res, next) => {
    const hostname = req.hostname as string | undefined;
    if (hostname === undefined || !allowed.has(hostname.toLowerCase())) {
      next(new AppError("ORIGIN_REJECTED", "This host name is not allowed to use the event API."));
      return;
    }
    next();
  };
}
```

`apps/event-api/src/http/middleware/origin-guard.ts`:

```ts
import type { RequestHandler } from "express";
import { AppError } from "../../shared/app-error.js";

export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Cross-origin mutations are rejected (S1). Browsers always send Origin on mutations, so a
 * request without one comes from a non-browser client (the feedback script, curl); the
 * loopback bind is the boundary for those.
 */
export function originGuard(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (!MUTATING_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.get("origin");
    const crossSite = req.get("sec-fetch-site") === "cross-site";
    if (crossSite || (origin !== undefined && !allowed.has(origin))) {
      next(new AppError("ORIGIN_REJECTED", "This page is not allowed to change event data."));
      return;
    }
    next();
  };
}
```

`apps/event-api/src/http/middleware/require-json.ts`:

```ts
import type { RequestHandler } from "express";
import { AppError } from "../../shared/app-error.js";
import { MUTATING_METHODS } from "./origin-guard.js";

/** Mutations must be JSON, which also blocks HTML-form CSRF (S1). */
export const requireJson: RequestHandler = (req, _res, next) => {
  if (MUTATING_METHODS.has(req.method) && req.is("application/json") !== "application/json") {
    next(new AppError("VALIDATION_FAILED", "Send the request body as JSON (Content-Type: application/json)."));
    return;
  }
  next();
};
```

`apps/event-api/src/http/middleware/not-found.ts`:

```ts
import type { RequestHandler } from "express";
import { AppError } from "../../shared/app-error.js";

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError("NOT_FOUND", `No API route for ${req.method} ${req.path}.`));
};
```

`apps/event-api/src/http/middleware/error-handler.ts`:

```ts
import { type ApiErrorBody, ERROR_HTTP_STATUS } from "@event-desk/contracts";
import type { ErrorRequestHandler } from "express";
import { AppError } from "../../shared/app-error.js";
import type { Logger } from "../../shared/logger.js";
import { requestLogger } from "./request-context.js";

const BODY_PARSER_MESSAGES: Record<string, string> = {
  "entity.parse.failed": "The request body is not valid JSON.",
  "entity.too.large": "The request body is too large.",
  "encoding.unsupported": "The request body encoding is not supported.",
  "charset.unsupported": "The request body charset is not supported.",
  "request.aborted": "The request was aborted.",
};

function bodyParserMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("type" in error)) return undefined;
  return typeof error.type === "string" ? BODY_PARSER_MESSAGES[error.type] : undefined;
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const parserMessage = bodyParserMessage(error);
  if (parserMessage !== undefined) return new AppError("VALIDATION_FAILED", parserMessage, { cause: error });
  return new AppError("INTERNAL", "Something went wrong. Try again.", { cause: error });
}

export function errorBody(error: AppError): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.field === undefined ? {} : { field: error.field }),
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    },
  };
}

/** The single place where errors become HTTP responses. 5xx bodies never carry internals. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const appError = toAppError(error);
    const status = ERROR_HTTP_STATUS[appError.code];
    const log = requestLogger(res, logger);
    if (status >= 500) log.error({ err: error, code: appError.code }, "request failed");
    else log.info({ code: appError.code }, "request rejected");
    if (appError.retryAfterMs !== undefined) {
      res.setHeader("Retry-After", String(Math.ceil(appError.retryAfterMs / 1000)));
    }
    res.status(status).json(errorBody(appError));
  };
}
```

- [ ] **Step 4: Implement validation, app and health**

`apps/event-api/src/http/validate.ts`:

```ts
import { type EventId, EventIdSchema } from "@event-desk/contracts";
import type { z } from "zod";
import { AppError } from "../shared/app-error.js";

/** Parses a request body with a contracts schema; failures become 400 VALIDATION_FAILED. */
export function validateBody<Schema extends z.ZodType>(schema: Schema, body: unknown): z.output<Schema> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const [issue] = result.error.issues;
  const field = issue !== undefined && issue.path.length > 0 ? issue.path.map(String).join(".") : undefined;
  const detail = issue === undefined ? "Invalid request body." : issue.message;
  throw new AppError(
    "VALIDATION_FAILED",
    field === undefined ? detail : `${field}: ${detail}`,
    field === undefined ? {} : { field },
  );
}

/** Route IDs are exact (binary collation): anything malformed is simply an unknown event. */
export function parseEventId(raw: string): EventId {
  const result = EventIdSchema.safeParse(raw);
  if (!result.success) throw new AppError("EVENT_NOT_FOUND", "Event not found.");
  return result.data;
}
```

`apps/event-api/src/app.ts`:

```ts
import express, { type Express, type Router } from "express";
import { errorHandler } from "./http/middleware/error-handler.js";
import { hostGuard } from "./http/middleware/host-guard.js";
import { notFound } from "./http/middleware/not-found.js";
import { originGuard } from "./http/middleware/origin-guard.js";
import { requestContext } from "./http/middleware/request-context.js";
import { requireJson } from "./http/middleware/require-json.js";
import type { Logger } from "./shared/logger.js";

export interface HttpPolicy {
  allowedOrigins: readonly string[];
  allowedHosts: readonly string[];
}

export interface AppOptions {
  logger: Logger;
  policy: HttpPolicy;
  routes: readonly Router[];
}

/** Builds the Express app from routers; the composition root decides which routers exist. */
export function createApp({ logger, policy, routes }: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestContext(logger));
  app.use(hostGuard(policy.allowedHosts));
  app.use(originGuard(policy.allowedOrigins));
  app.use(requireJson);
  app.use(express.json({ limit: "64kb" }));
  const api = express.Router();
  for (const router of routes) api.use(router);
  app.use("/api", api);
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
```

`apps/event-api/src/ports/health-probe.ts`:

```ts
/** A dependency that can report whether it is reachable. Implementations must not throw. */
export interface HealthProbe {
  isUp(): Promise<boolean>;
}
```

`apps/event-api/src/modules/health/health-controller.ts`:

```ts
import express, { type Router } from "express";
import type { HealthProbe } from "../../ports/health-probe.js";

export interface HealthProbes {
  mysql: HealthProbe;
  redis: HealthProbe;
}

const isUp = (probe: HealthProbe) => probe.isUp().catch(() => false);

/** MySQL is required (503 when down); Redis is optional because reads fall back to MySQL. */
export function healthRoutes(probes: HealthProbes): Router {
  const router = express.Router();
  router.get("/health", async (_req, res) => {
    const [mysql, redis] = await Promise.all([isUp(probes.mysql), isUp(probes.redis)]);
    res
      .set("Cache-Control", "no-store")
      .status(mysql ? 200 : 503)
      .json({ mysql: mysql ? "up" : "down", redis: redis ? "up" : "down" });
  });
  return router;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0, including `pnpm arch`.

```bash
git add apps/event-api/src
git commit -m "feat(event-api): HTTP policy, error envelope, validation and health route" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Schema migration, data source, integration harness, DB constraints and CI job

**Files:**
- Create: `apps/event-api/src/persistence/migrations/1790985600000-initial-schema.ts`
- Create: `apps/event-api/src/persistence/data-source.ts`, `apps/event-api/src/persistence/entities/index.ts`, `apps/event-api/src/persistence/entities/column-types.ts`
- Create: `apps/event-api/vitest.integration.config.ts`
- Create: `apps/event-api/src/testing/test-config.ts`, `database.ts`, `sql-fixtures.ts`, `integration-global-setup.ts`
- Modify: root `package.json` (`test:integration`), `.github/workflows/ci.yml` (integration job)
- Test: `apps/event-api/src/persistence/schema.int.test.ts`

**Interfaces:**
- Consumes: `AppConfig` (Task 1); contracts `SUPPLIED_EVENT`, `SUPPLIED_MEMBERS`, `SUPPLIED_FEEDBACK`, `SUPPLIED_FEEDBACK_DIGEST`.
- Produces:
  - `createDataSource(mysqlUrl: string): DataSource`, with `timezone: "Z"`, no synchronize, migrations table `schema_migrations`.
  - `ENTITIES` (mutable list; Tasks 5 and 7 append) and `asciiBin`.
  - `InitialSchema1790985600000`.
  - Test helpers:
    - `integrationConfig(overrides?): AppConfig`, `testMysqlUrl()`, `testRedisUrl()`, `silentLogger`.
    - `openTestDataSource()`, `truncateAllTables(ds)`, `APPLICATION_TABLES`.
    - `insertEventFixture(ds)` (raw-SQL E101 with supplied members/notes), `insertGenerationFixture(ds, spec?): Promise<string>` (returns the generation ID), `putPreviewSlot(ds, slot, generationId)`, `insertSavedBriefing(ds, spec)`, `insertOutcome(ds, spec)`.
    - `GENERATION_FIXTURE_ID` constants.

- [ ] **Step 1: Write the migration**

`apps/event-api/src/persistence/migrations/1790985600000-initial-schema.ts`. The statements are the T4 §4 DDL verbatim, one statement per array element:

```ts
import type { MigrationInterface, QueryRunner } from "typeorm";

// T4 §4: the DDL is the source of truth. MySQL DDL commits implicitly, so the migration
// runs without a wrapping transaction (data-source.ts: migrationsTransactionMode "none").
const CREATE_STATEMENTS: readonly string[] = [
  `CREATE TABLE events (
  id                     VARCHAR(16)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name                   VARCHAR(120) NOT NULL,
  club_name              VARCHAR(120) NOT NULL,
  status                 ENUM('ended') NOT NULL,
  attendance_revision    INT UNSIGNED NOT NULL DEFAULT 0,
  briefing_revision      INT UNSIGNED NOT NULL DEFAULT 0,
  next_feedback_number   INT UNSIGNED NOT NULL,
  feedback_pending_since DATETIME(3)  NULL,
  created_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE members (
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id            VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name          VARCHAR(120) NOT NULL,
  attendance    ENUM('attended','absent','not_recorded') NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (event_id, id),
  UNIQUE KEY uq_members_order (event_id, display_order),
  CONSTRAINT fk_members_event FOREIGN KEY (event_id) REFERENCES events (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE feedback_notes (
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id            VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  text          VARCHAR(1000) NOT NULL,
  origin        ENUM('seed','submitted') NOT NULL,
  submission_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  received_at   DATETIME(3) NOT NULL,
  display_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (event_id, id),
  UNIQUE KEY uq_feedback_submission (event_id, submission_id),
  UNIQUE KEY uq_feedback_order (event_id, display_order),
  CONSTRAINT fk_feedback_event FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT ck_feedback_text CHECK (CHAR_LENGTH(TRIM(text)) > 0),
  CONSTRAINT ck_feedback_origin CHECK ((origin = 'seed') = (submission_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE briefing_generations (
  id                  CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id            VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_id              VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  trigger_type        ENUM('manual','feedback_batch') NOT NULL,
  model               VARCHAR(100) NOT NULL,
  prompt_version      VARCHAR(32)  NOT NULL,
  attendance_overview VARCHAR(500) NOT NULL,
  feedback_digest     CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  input_captured_at   DATETIME(3) NOT NULL,
  generated_at        DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_generation_run (run_id),
  UNIQUE KEY uq_generation_event (event_id, id),
  CONSTRAINT fk_generation_event FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT ck_generation_overview CHECK (CHAR_LENGTH(TRIM(attendance_overview)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE generation_attendance_inputs (
  generation_id CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  member_id     VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attendance    ENUM('attended','absent','not_recorded') NOT NULL,
  PRIMARY KEY (generation_id, member_id),
  CONSTRAINT fk_att_input_generation FOREIGN KEY (event_id, generation_id)
    REFERENCES briefing_generations (event_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_att_input_member FOREIGN KEY (event_id, member_id) REFERENCES members (event_id, id)
) ENGINE=InnoDB`,
  `CREATE TABLE generation_feedback_inputs (
  generation_id CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  feedback_id   VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (generation_id, feedback_id),
  CONSTRAINT fk_fb_input_generation FOREIGN KEY (event_id, generation_id)
    REFERENCES briefing_generations (event_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_fb_input_note FOREIGN KEY (event_id, feedback_id) REFERENCES feedback_notes (event_id, id)
) ENGINE=InnoDB`,
  `CREATE TABLE briefing_items (
  id            CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  section       ENUM('summary','theme','conflict','suggestion') NOT NULL,
  position      TINYINT UNSIGNED NOT NULL,
  text          VARCHAR(1000) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_position (generation_id, section, position),
  UNIQUE KEY uq_item_generation (generation_id, id),
  CONSTRAINT fk_item_generation FOREIGN KEY (generation_id) REFERENCES briefing_generations (id) ON DELETE CASCADE,
  CONSTRAINT ck_item_position CHECK (position < 10),
  CONSTRAINT ck_item_summary CHECK (section <> 'summary' OR (position = 0 AND CHAR_LENGTH(text) <= 600)),
  CONSTRAINT ck_item_text CHECK (CHAR_LENGTH(TRIM(text)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE briefing_item_sources (
  item_id       CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generation_id CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  feedback_id   VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  position      TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (item_id, feedback_id),
  UNIQUE KEY uq_source_position (item_id, position),
  CONSTRAINT fk_source_item FOREIGN KEY (generation_id, item_id)
    REFERENCES briefing_items (generation_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_source_input FOREIGN KEY (generation_id, feedback_id)
    REFERENCES generation_feedback_inputs (generation_id, feedback_id) ON DELETE CASCADE,
  CONSTRAINT ck_source_position CHECK (position < 8)
) ENGINE=InnoDB`,
  `CREATE TABLE preview_slots (
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slot          ENUM('selected','incoming') NOT NULL,
  generation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at    DATETIME(3) NOT NULL,
  PRIMARY KEY (event_id, slot),
  UNIQUE KEY uq_slot_generation (generation_id),
  CONSTRAINT fk_slot_generation FOREIGN KEY (event_id, generation_id)
    REFERENCES briefing_generations (event_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB`,
  `CREATE TABLE saved_briefings (
  event_id            VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generation_id       CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attendance_overview VARCHAR(500) NOT NULL,
  saved_at            DATETIME(3) NOT NULL,
  PRIMARY KEY (event_id),
  UNIQUE KEY uq_saved_generation (event_id, generation_id),
  CONSTRAINT fk_saved_generation FOREIGN KEY (event_id, generation_id)
    REFERENCES briefing_generations (event_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_saved_overview CHECK (CHAR_LENGTH(TRIM(attendance_overview)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE saved_briefing_items (
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generation_id CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id       CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  text          VARCHAR(1000) NOT NULL,
  PRIMARY KEY (event_id, item_id),
  CONSTRAINT fk_saved_item_briefing FOREIGN KEY (event_id, generation_id)
    REFERENCES saved_briefings (event_id, generation_id) ON DELETE CASCADE,
  CONSTRAINT fk_saved_item_item FOREIGN KEY (generation_id, item_id)
    REFERENCES briefing_items (generation_id, id),
  CONSTRAINT ck_saved_item_text CHECK (CHAR_LENGTH(TRIM(text)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE generation_outcomes (
  run_id        VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id      VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  trigger_type  ENUM('manual','feedback_batch') NOT NULL,
  status        ENUM('succeeded','failed','skipped','superseded','superseded_by_manual') NOT NULL,
  error_code    VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  generation_id CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  finished_at   DATETIME(3) NOT NULL,
  PRIMARY KEY (run_id),
  KEY ix_outcomes_recent (event_id, finished_at),
  CONSTRAINT fk_outcome_event FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT ck_outcome_error CHECK ((status = 'failed') = (error_code IS NOT NULL))
) ENGINE=InnoDB`,
];

/** Drop order: children before parents. */
export const SCHEMA_TABLES_CHILD_FIRST = [
  "saved_briefing_items",
  "saved_briefings",
  "preview_slots",
  "briefing_item_sources",
  "briefing_items",
  "generation_feedback_inputs",
  "generation_attendance_inputs",
  "generation_outcomes",
  "briefing_generations",
  "feedback_notes",
  "members",
  "events",
] as const;

export class InitialSchema1790985600000 implements MigrationInterface {
  name = "InitialSchema1790985600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of CREATE_STATEMENTS) await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of SCHEMA_TABLES_CHILD_FIRST) await queryRunner.query(`DROP TABLE IF EXISTS \`${table}\``);
  }
}
```

Compare the twelve statements with `docs/specs/13-data-model-and-transactions.md` §4 before continuing. They must match it clause for clause, apart from the trailing semicolons.

- [ ] **Step 2: Write the data source**

`apps/event-api/src/persistence/entities/column-types.ts`:

```ts
/** Business IDs and hashes are exact, case-sensitive ASCII (T4 §1). */
export const asciiBin = { charset: "ascii", collation: "ascii_bin" } as const;
```

`apps/event-api/src/persistence/entities/index.ts`:

```ts
import type { EntitySchema } from "typeorm";

/** Every mapped table; tasks add their EntitySchemas here. */
export const ENTITIES: EntitySchema[] = [];
```

`apps/event-api/src/persistence/data-source.ts`:

```ts
import { DataSource } from "typeorm";
import { ENTITIES } from "./entities/index.js";
import { InitialSchema1790985600000 } from "./migrations/1790985600000-initial-schema.js";

/** MySQL 8.4 through TypeORM: UTC DATETIME(3), hand-written migrations, never synchronize (T4 §1). */
export function createDataSource(mysqlUrl: string): DataSource {
  return new DataSource({
    type: "mysql",
    url: mysqlUrl,
    timezone: "Z",
    charset: "utf8mb4_0900_ai_ci",
    connectTimeout: 2_000,
    poolSize: 10,
    entities: ENTITIES,
    migrations: [InitialSchema1790985600000],
    migrationsTableName: "schema_migrations",
    migrationsTransactionMode: "none",
    synchronize: false,
    logging: false,
  });
}
```

- [ ] **Step 3: Write the integration harness**

`apps/event-api/src/testing/test-config.ts`:

```ts
import type { AppConfig } from "../config/env.js";
import { createLogger } from "../shared/logger.js";

export const testMysqlUrl = (): string =>
  process.env.TEST_MYSQL_URL ?? "mysql://event_desk:event_desk_local@127.0.0.1:3306/event_desk_test";
export const testRedisUrl = (): string => process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/1";

export const silentLogger = createLogger("silent");

export function integrationConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    mysqlUrl: testMysqlUrl(),
    redisUrl: testRedisUrl(),
    allowedOrigins: ["http://localhost:5173"],
    allowedHosts: ["127.0.0.1", "localhost"],
    eventViewCacheTtlMs: 30_000,
    logLevel: "silent",
    ...overrides,
  };
}
```

`apps/event-api/src/testing/integration-global-setup.ts`:

```ts
import { createConnection } from "mysql2/promise";
import { createDataSource } from "../persistence/data-source.js";
import { testMysqlUrl } from "./test-config.js";

/** Recreates event_desk_test once per integration run and applies the migrations. */
export default async function setup(): Promise<void> {
  const url = new URL(testMysqlUrl());
  const database = decodeURIComponent(url.pathname.slice(1));
  if (database !== "event_desk_test") {
    throw new Error(`Integration tests only run against event_desk_test (got "${database}").`);
  }
  const server = new URL(url);
  server.pathname = "/";
  const connection = await createConnection(server.toString());
  try {
    await connection.query("DROP DATABASE IF EXISTS `event_desk_test`");
    await connection.query(
      "CREATE DATABASE `event_desk_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci",
    );
  } finally {
    await connection.end();
  }
  const dataSource = createDataSource(url.toString());
  await dataSource.initialize();
  try {
    await dataSource.runMigrations({ transaction: "none" });
  } finally {
    await dataSource.destroy();
  }
}
```

`apps/event-api/src/testing/database.ts`:

```ts
import type { DataSource } from "typeorm";
import { createDataSource } from "../persistence/data-source.js";
import { SCHEMA_TABLES_CHILD_FIRST } from "../persistence/migrations/1790985600000-initial-schema.js";
import { testMysqlUrl } from "./test-config.js";

export const APPLICATION_TABLES = SCHEMA_TABLES_CHILD_FIRST;

export async function openTestDataSource(): Promise<DataSource> {
  const dataSource = createDataSource(testMysqlUrl());
  await dataSource.initialize();
  return dataSource;
}

/** Empties every application table on one connection (FOREIGN_KEY_CHECKS is per session). */
export async function truncateAllTables(dataSource: DataSource): Promise<void> {
  const runner = dataSource.createQueryRunner();
  try {
    await runner.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of APPLICATION_TABLES) await runner.query(`TRUNCATE TABLE \`${table}\``);
    await runner.query("SET FOREIGN_KEY_CHECKS = 1");
  } finally {
    await runner.release();
  }
}
```

`apps/event-api/src/testing/sql-fixtures.ts`:

```ts
import {
  type AttendanceStatus,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_FEEDBACK_DIGEST,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import type { DataSource } from "typeorm";

export const FIXTURE_TIME = new Date("2026-10-03T09:00:00.000Z");
export const GENERATION_FIXTURE_ID = "0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f";
export const OTHER_GENERATION_FIXTURE_ID = "0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e80";

/** Raw-SQL E101 with the supplied roster and notes; independent of the seeder under test. */
export async function insertEventFixture(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    "INSERT INTO events (id, name, club_name, status, next_feedback_number) VALUES (?, ?, ?, 'ended', 9)",
    [SUPPLIED_EVENT.id, SUPPLIED_EVENT.name, SUPPLIED_EVENT.clubName],
  );
  for (const [index, member] of SUPPLIED_MEMBERS.entries()) {
    await dataSource.query(
      "INSERT INTO members (event_id, id, name, attendance, display_order) VALUES (?, ?, ?, ?, ?)",
      [SUPPLIED_EVENT.id, member.id, member.name, member.attendance, index + 1],
    );
  }
  for (const [index, note] of SUPPLIED_FEEDBACK.entries()) {
    await dataSource.query(
      "INSERT INTO feedback_notes (event_id, id, text, origin, received_at, display_order) VALUES (?, ?, ?, 'seed', ?, ?)",
      [SUPPLIED_EVENT.id, note.id, note.text, FIXTURE_TIME, index + 1],
    );
  }
}

export interface ItemFixture {
  id: string;
  section: "summary" | "theme" | "conflict" | "suggestion";
  position: number;
  text: string;
  sourceIds: string[];
}

export interface GenerationFixture {
  id?: string;
  runId?: string;
  trigger?: "manual" | "feedback_batch";
  attendance?: { memberId: string; attendance: AttendanceStatus }[];
  feedbackIds?: string[];
  feedbackDigest?: string;
  items?: ItemFixture[];
}

export const DEFAULT_ITEMS: ItemFixture[] = [
  {
    id: "0199a4e8-0000-7000-8000-000000000001",
    section: "summary",
    position: 0,
    text: "Feedback describes the walk as enjoyable, with comments mostly about logistics.",
    sourceIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"],
  },
  {
    id: "0199a4e8-0000-7000-8000-000000000002",
    section: "theme",
    position: 0,
    text: "Requests for more rest-break time.",
    sourceIds: ["F05", "F06"],
  },
  {
    id: "0199a4e8-0000-7000-8000-000000000003",
    section: "conflict",
    position: 0,
    text: "One note asks for an earlier start; another says it would be difficult.",
    sourceIds: ["F03", "F04"],
  },
  {
    id: "0199a4e8-0000-7000-8000-000000000004",
    section: "suggestion",
    position: 0,
    text: "Consider reviewing the route length.",
    sourceIds: ["F07"],
  },
];

/**
 * Writes one immutable generation (row, inputs, items, sources) as Plan 3's commit will.
 * Defaults: captured from the supplied seed records with the real digest, so it is current.
 */
export async function insertGenerationFixture(dataSource: DataSource, spec: GenerationFixture = {}): Promise<string> {
  const id = spec.id ?? GENERATION_FIXTURE_ID;
  const eventId = SUPPLIED_EVENT.id;
  const attendance =
    spec.attendance ?? SUPPLIED_MEMBERS.map((m) => ({ memberId: m.id, attendance: m.attendance }));
  const feedbackIds = spec.feedbackIds ?? SUPPLIED_FEEDBACK.map((n) => n.id);
  await dataSource.query(
    `INSERT INTO briefing_generations (id, event_id, run_id, trigger_type, model, prompt_version,
       attendance_overview, feedback_digest, input_captured_at, generated_at)
     VALUES (?, ?, ?, ?, 'fixture-model', 'briefing-v1', ?, ?, ?, ?)`,
    [
      id,
      eventId,
      spec.runId ?? `manual:${id}`,
      spec.trigger ?? "manual",
      "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
      spec.feedbackDigest ?? SUPPLIED_FEEDBACK_DIGEST,
      FIXTURE_TIME,
      FIXTURE_TIME,
    ],
  );
  for (const input of attendance) {
    await dataSource.query(
      "INSERT INTO generation_attendance_inputs (generation_id, event_id, member_id, attendance) VALUES (?, ?, ?, ?)",
      [id, eventId, input.memberId, input.attendance],
    );
  }
  for (const feedbackId of feedbackIds) {
    await dataSource.query(
      "INSERT INTO generation_feedback_inputs (generation_id, event_id, feedback_id) VALUES (?, ?, ?)",
      [id, eventId, feedbackId],
    );
  }
  for (const item of spec.items ?? DEFAULT_ITEMS) {
    await dataSource.query(
      "INSERT INTO briefing_items (id, generation_id, section, position, text) VALUES (?, ?, ?, ?, ?)",
      [item.id, id, item.section, item.position, item.text],
    );
    for (const [position, feedbackId] of item.sourceIds.entries()) {
      await dataSource.query(
        "INSERT INTO briefing_item_sources (item_id, generation_id, feedback_id, position) VALUES (?, ?, ?, ?)",
        [item.id, id, feedbackId, position],
      );
    }
  }
  return id;
}

export async function putPreviewSlot(
  dataSource: DataSource,
  slot: "selected" | "incoming",
  generationId: string,
): Promise<void> {
  await dataSource.query(
    "INSERT INTO preview_slots (event_id, slot, generation_id, updated_at) VALUES (?, ?, ?, ?)",
    [SUPPLIED_EVENT.id, slot, generationId, FIXTURE_TIME],
  );
}

export interface SavedBriefingFixture {
  generationId: string;
  attendanceOverview: string;
  itemTexts: Record<string, string>;
}

export async function insertSavedBriefing(dataSource: DataSource, spec: SavedBriefingFixture): Promise<void> {
  await dataSource.query(
    "INSERT INTO saved_briefings (event_id, generation_id, attendance_overview, saved_at) VALUES (?, ?, ?, ?)",
    [SUPPLIED_EVENT.id, spec.generationId, spec.attendanceOverview, FIXTURE_TIME],
  );
  for (const [itemId, text] of Object.entries(spec.itemTexts)) {
    await dataSource.query(
      "INSERT INTO saved_briefing_items (event_id, generation_id, item_id, text) VALUES (?, ?, ?, ?)",
      [SUPPLIED_EVENT.id, spec.generationId, itemId, text],
    );
  }
}

export interface OutcomeFixture {
  runId: string;
  trigger: "manual" | "feedback_batch";
  status: "succeeded" | "failed" | "skipped" | "superseded" | "superseded_by_manual";
  errorCode?: string;
  finishedAt: Date;
}

export async function insertOutcome(dataSource: DataSource, spec: OutcomeFixture): Promise<void> {
  await dataSource.query(
    "INSERT INTO generation_outcomes (run_id, event_id, trigger_type, status, error_code, finished_at) VALUES (?, ?, ?, ?, ?, ?)",
    [spec.runId, SUPPLIED_EVENT.id, spec.trigger, spec.status, spec.errorCode ?? null, spec.finishedAt],
  );
}
```

`apps/event-api/vitest.integration.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { workspaceSourceResolution } from "./vitest.shared.config";

export default defineConfig({
  ...workspaceSourceResolution,
  test: {
    name: "event-api-integration",
    include: ["src/**/*.int.test.ts"],
    environment: "node",
    globalSetup: ["src/testing/integration-global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
```

Root `package.json` `scripts`: add `"test:integration": "pnpm --filter @event-desk/event-api test:integration",`.

- [ ] **Step 4: Write the failing constraint tests**

`apps/event-api/src/persistence/schema.int.test.ts`:

```ts
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { APPLICATION_TABLES, openTestDataSource, truncateAllTables } from "../testing/database.js";
import {
  DEFAULT_ITEMS,
  GENERATION_FIXTURE_ID,
  insertEventFixture,
  insertGenerationFixture,
  insertSavedBriefing,
  OTHER_GENERATION_FIXTURE_ID,
  putPreviewSlot,
} from "../testing/sql-fixtures.js";

const ER_NO_REFERENCED_ROW_2 = 1452;
const ER_ROW_IS_REFERENCED_2 = 1451;
const ER_CHECK_CONSTRAINT_VIOLATED = 3819;

const rejectsWith = (promise: Promise<unknown>, errno: number) =>
  expect(promise).rejects.toMatchObject({ driverError: { errno } });

const [summaryItem, themeItem] = DEFAULT_ITEMS;
if (summaryItem === undefined || themeItem === undefined) throw new Error("fixture items missing");

let dataSource: DataSource;

beforeAll(async () => {
  dataSource = await openTestDataSource();
});
afterAll(async () => {
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await insertEventFixture(dataSource);
});

describe("T4 schema", () => {
  it("creates every table from the DDL", async () => {
    const rows = await dataSource.query<{ TABLE_NAME: string }[]>(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
    );
    const tables = rows.map((r) => r.TABLE_NAME);
    for (const table of APPLICATION_TABLES) expect(tables).toContain(table);
  });

  it("T4-01: rejects a citation of a note outside the generation's input", async () => {
    await insertGenerationFixture(dataSource, {
      feedbackIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07"],
      items: [{ ...themeItem, sourceIds: ["F05", "F06"] }, { ...summaryItem, sourceIds: ["F01"] }],
    });
    await rejectsWith(
      dataSource.query(
        "INSERT INTO briefing_item_sources (item_id, generation_id, feedback_id, position) VALUES (?, ?, 'F08', 2)",
        [themeItem.id, GENERATION_FIXTURE_ID],
      ),
      ER_NO_REFERENCED_ROW_2,
    );
  });

  it("T4-02: a saved text row cannot point at another generation's item", async () => {
    await insertGenerationFixture(dataSource);
    await insertGenerationFixture(dataSource, {
      id: OTHER_GENERATION_FIXTURE_ID,
      items: DEFAULT_ITEMS.map((item, i) => ({ ...item, id: `0199a4e8-0000-7000-8000-00000000010${i}` })),
    });
    await rejectsWith(
      insertSavedBriefing(dataSource, {
        generationId: GENERATION_FIXTURE_ID,
        attendanceOverview: "Edited overview.",
        itemTexts: { "0199a4e8-0000-7000-8000-000000000100": "Belongs to the other generation." },
      }),
      ER_NO_REFERENCED_ROW_2,
    );
  });

  it("T4-03: a referenced generation cannot be deleted; an unreferenced one cascades", async () => {
    await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", GENERATION_FIXTURE_ID);
    await rejectsWith(
      dataSource.query("DELETE FROM briefing_generations WHERE id = ?", [GENERATION_FIXTURE_ID]),
      ER_ROW_IS_REFERENCED_2,
    );
    await dataSource.query("DELETE FROM preview_slots");
    await dataSource.query("DELETE FROM briefing_generations WHERE id = ?", [GENERATION_FIXTURE_ID]);
    for (const table of ["briefing_items", "briefing_item_sources", "generation_feedback_inputs", "generation_attendance_inputs"]) {
      const [row] = await dataSource.query<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`);
      expect(Number(row?.n)).toBe(0);
    }
  });

  it("T4-10: IDs match exactly (binary collation)", async () => {
    const lower = await dataSource.query<unknown[]>("SELECT id FROM feedback_notes WHERE id = 'f01'");
    const exact = await dataSource.query<unknown[]>("SELECT id FROM feedback_notes WHERE id = 'F01'");
    expect(lower).toHaveLength(0);
    expect(exact).toHaveLength(1);
  });

  it("T4-11: blank text fails the CHECK constraints", async () => {
    await rejectsWith(
      dataSource.query(
        "INSERT INTO feedback_notes (event_id, id, text, origin, submission_id, received_at, display_order) VALUES ('E101', 'F09', '   ', 'submitted', UUID(), NOW(3), 9)",
      ),
      ER_CHECK_CONSTRAINT_VIOLATED,
    );
    await rejectsWith(
      insertGenerationFixture(dataSource, { items: [{ ...summaryItem, text: " \t " }] }),
      ER_CHECK_CONSTRAINT_VIOLATED,
    );
  });

  it("allows one feedback summary, at position 0, within 600 characters", async () => {
    await rejectsWith(
      insertGenerationFixture(dataSource, { items: [{ ...summaryItem, position: 1 }] }),
      ER_CHECK_CONSTRAINT_VIOLATED,
    );
    await truncateAllTables(dataSource);
    await insertEventFixture(dataSource);
    await rejectsWith(
      insertGenerationFixture(dataSource, { items: [{ ...summaryItem, text: "x".repeat(601) }] }),
      ER_CHECK_CONSTRAINT_VIOLATED,
    );
  });

  it("requires an error code exactly when an outcome failed", async () => {
    await rejectsWith(
      dataSource.query(
        "INSERT INTO generation_outcomes (run_id, event_id, trigger_type, status, finished_at) VALUES ('r1', 'E101', 'manual', 'failed', NOW(3))",
      ),
      ER_CHECK_CONSTRAINT_VIOLATED,
    );
  });
});
```

- [ ] **Step 5: Run the integration tests**

Run: `pnpm test:integration`
Expected: PASS. The migration and harness already exist from Steps 1–3, so these tests prove the DDL. If one fails, the DDL differs from T4 §4: fix the migration, not the test.

Then prove that the suite can fail. Temporarily change `ck_item_summary` in the migration to `CHECK (TRUE)`, and run `pnpm test:integration`.
Expected: FAIL in "allows one feedback summary…". Revert the change and run again: PASS.

- [ ] **Step 6: Add the CI integration job**

Append to `jobs:` in `.github/workflows/ci.yml` (the comment line about Plan 2 adding the job can be removed):

```yaml
  integration:
    name: integration tests (MySQL 8.4, Redis 8)
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.4
        env:
          MYSQL_ROOT_PASSWORD: event_desk_root
          MYSQL_DATABASE: event_desk_test
          MYSQL_USER: event_desk
          MYSQL_PASSWORD: event_desk_local
        ports:
          - 3306:3306
        options: >-
          --health-cmd "mysqladmin ping -h 127.0.0.1 -uroot -pevent_desk_root --silent"
          --health-interval 5s --health-timeout 5s --health-retries 30
      redis:
        image: redis:8
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping" --health-interval 5s --health-timeout 3s --health-retries 20
    env:
      TEST_MYSQL_URL: mysql://event_desk:event_desk_local@127.0.0.1:3306/event_desk_test
      TEST_REDIS_URL: redis://127.0.0.1:6379/1
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:integration
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm format && pnpm verify && pnpm test:integration`
Expected: both exit 0.

```bash
git add apps/event-api package.json .github/workflows/ci.yml
git commit -m "feat(event-api): T4 schema migration, integration harness and DB constraint tests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Event entities, unit of work and event repository

**Files:**
- Create: `apps/event-api/src/persistence/entities/event.entities.ts`
- Modify: `apps/event-api/src/persistence/entities/index.ts`
- Create: `apps/event-api/src/ports/unit-of-work.ts`
- Create: `apps/event-api/src/repositories/row-parsing.ts`, `store-errors.ts`, `event-repository.ts`, `typeorm-unit-of-work.ts`
- Test: `apps/event-api/src/repositories/store-errors.test.ts`, `apps/event-api/src/repositories/typeorm-unit-of-work.int.test.ts`

**Interfaces:**
- Consumes: `createDataSource`, `ENTITIES`, `asciiBin` and the test helpers (Task 4); `AppError`, `Logger` (Task 1); contracts `EventSummarySchema`, `MemberSchema`, `FeedbackNoteSchema`, `ATTENDANCE_STATUSES`, `AttendanceChange`, `EventId`, `EventSummary`, `Member`, `FeedbackNote`.
- Produces:
  - Entities: `EventEntity`/`EventRow`, `MemberEntity`/`MemberRow`, `FeedbackNoteEntity`/`FeedbackNoteRow`.
  - Ports: `EventAggregate` (`{ event: EventSummary; attendanceRevision; briefingRevision; members: Member[]; feedback: FeedbackNote[] }`), `EventReadRepository.findAggregate(eventId): Promise<EventAggregate | null>`, `EventWriteRepository` (`+ lockForUpdate(eventId): Promise<EventAggregate>`, `applyAttendanceChanges(eventId, changes): Promise<void>`), `ReadScope` (`{ events }`), `TransactionScope` (`{ events: EventWriteRepository; afterCommit(effect) }`), `UnitOfWork` (`run`, `readSnapshot`).
  - `TypeOrmUnitOfWork(dataSource, logger)`, `TypeOrmEventRepository(manager)`.
  - `parseStoredRow(schema, row, table)`, `toIsoTimestamp(value)`.
  - `toStoreError(error): AppError`, `storeUnavailable(cause): AppError`, `isConnectionError(error): boolean`.

- [ ] **Step 1: Write the failing tests**

`apps/event-api/src/repositories/store-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "../shared/app-error.js";
import { isConnectionError, toStoreError } from "./store-errors.js";

describe("toStoreError", () => {
  it("passes AppErrors through unchanged", () => {
    const error = new AppError("EVENT_NOT_FOUND", "Event E999 was not found.");
    expect(toStoreError(error)).toBe(error);
  });

  it.each(["ECONNREFUSED", "PROTOCOL_CONNECTION_LOST", "ETIMEDOUT"])("maps %s to STORE_UNAVAILABLE", (code) => {
    const direct = toStoreError(Object.assign(new Error("x"), { code }));
    const wrapped = toStoreError(Object.assign(new Error("query failed"), { driverError: { code } }));
    expect(direct.code).toBe("STORE_UNAVAILABLE");
    expect(wrapped.code).toBe("STORE_UNAVAILABLE");
  });

  it("maps other database failures to INTERNAL and keeps the cause", () => {
    const cause = Object.assign(new Error("duplicate"), { driverError: { code: "ER_DUP_ENTRY" } });
    const error = toStoreError(cause);
    expect(error.code).toBe("INTERNAL");
    expect(error.cause).toBe(cause);
    expect(isConnectionError(cause)).toBe(false);
  });
});
```

`apps/event-api/src/repositories/typeorm-unit-of-work.int.test.ts`:

```ts
import {
  EventIdSchema,
  MemberIdSchema,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import { setTimeout as sleep } from "node:timers/promises";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDataSource } from "../persistence/data-source.js";
import { AppError } from "../shared/app-error.js";
import { openTestDataSource, truncateAllTables } from "../testing/database.js";
import { insertEventFixture } from "../testing/sql-fixtures.js";
import { silentLogger, testMysqlUrl } from "../testing/test-config.js";
import { TypeOrmUnitOfWork } from "./typeorm-unit-of-work.js";

const E101 = SUPPLIED_EVENT.id;
const E999 = EventIdSchema.parse("E999");
const M03 = MemberIdSchema.parse("M03");
let dataSource: DataSource;
let uow: TypeOrmUnitOfWork;

const chrisStatus = async () => {
  const [row] = await dataSource.query<{ attendance: string }[]>(
    "SELECT attendance FROM members WHERE event_id = ? AND id = ?",
    [E101, M03],
  );
  return row?.attendance;
};

beforeAll(async () => {
  dataSource = await openTestDataSource();
  uow = new TypeOrmUnitOfWork(dataSource, silentLogger);
});
afterAll(async () => {
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await insertEventFixture(dataSource);
});

describe("TypeOrmUnitOfWork + TypeOrmEventRepository", () => {
  it("reads the aggregate in a read-only snapshot", async () => {
    const aggregate = await uow.readSnapshot((scope) => scope.events.findAggregate(E101));
    expect(aggregate?.event).toEqual(SUPPLIED_EVENT);
    expect(aggregate?.members).toEqual(SUPPLIED_MEMBERS);
    expect(aggregate?.feedback.map((n) => [n.id, n.text])).toEqual(SUPPLIED_FEEDBACK.map((n) => [n.id, n.text]));
    expect(aggregate?.attendanceRevision).toBe(0);
  });

  it("returns null for an unknown event", async () => {
    expect(await uow.readSnapshot((scope) => scope.events.findAggregate(E999))).toBeNull();
  });

  it("commits changes, bumps the revision and runs afterCommit effects after the commit", async () => {
    const seenByEffect: (string | undefined)[] = [];
    await uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      await tx.events.applyAttendanceChanges(E101, [{ memberId: M03, from: "not_recorded", to: "attended" }]);
      tx.afterCommit(async () => {
        seenByEffect.push(await chrisStatus());
      });
    });
    expect(seenByEffect).toEqual(["attended"]);
    const [event] = await dataSource.query<{ attendance_revision: number }[]>(
      "SELECT attendance_revision FROM events WHERE id = ?",
      [E101],
    );
    expect(event?.attendance_revision).toBe(1);
  });

  it("rolls back everything and skips effects when the work throws", async () => {
    let effectRan = false;
    const failure = uow.run(async (tx) => {
      await tx.events.applyAttendanceChanges(E101, [{ memberId: M03, from: "not_recorded", to: "attended" }]);
      tx.afterCommit(() => {
        effectRan = true;
        return Promise.resolve();
      });
      throw new AppError("ATTENDANCE_CONFLICT", "stale");
    });
    await expect(failure).rejects.toMatchObject({ code: "ATTENDANCE_CONFLICT" });
    expect(effectRan).toBe(false);
    expect(await chrisStatus()).toBe("not_recorded");
  });

  it("serialises writers on the event row lock (T4 §6)", async () => {
    const order: string[] = [];
    const first = uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      order.push("first locked");
      await sleep(300);
      order.push("first done");
    });
    while (!order.includes("first locked")) await sleep(10);
    const second = uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      order.push("second locked");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first locked", "first done", "second locked"]);
  });

  it("answers EVENT_NOT_FOUND when locking an unknown event", async () => {
    await expect(uow.run((tx) => tx.events.lockForUpdate(E999))).rejects.toMatchObject({
      code: "EVENT_NOT_FOUND",
    });
  });

  it("reports corrupt rows as STORE_CORRUPT instead of inventing data (F1-05)", async () => {
    await dataSource.query("UPDATE members SET name = '' WHERE event_id = ? AND id = ?", [E101, M03]);
    await expect(uow.readSnapshot((scope) => scope.events.findAggregate(E101))).rejects.toMatchObject({
      code: "STORE_CORRUPT",
    });
  });

  it("reports an event with no members as STORE_CORRUPT", async () => {
    await dataSource.query("DELETE FROM members WHERE event_id = ?", [E101]);
    await expect(uow.readSnapshot((scope) => scope.events.findAggregate(E101))).rejects.toMatchObject({
      code: "STORE_CORRUPT",
    });
  });

  it("fails fast with STORE_UNAVAILABLE when the store is gone", async () => {
    const gone = createDataSource(testMysqlUrl());
    await gone.initialize();
    await gone.destroy();
    const unavailable = new TypeOrmUnitOfWork(gone, silentLogger);
    await expect(unavailable.readSnapshot((scope) => scope.events.findAggregate(E101))).rejects.toMatchObject({
      code: "STORE_UNAVAILABLE",
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test && pnpm test:integration`
Expected: FAIL. `Failed to resolve import "./store-errors.js"` and `"./typeorm-unit-of-work.js"`.

- [ ] **Step 3: Implement the entities and ports**

`apps/event-api/src/persistence/entities/event.entities.ts`:

```ts
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@event-desk/contracts";
import { EntitySchema } from "typeorm";
import { asciiBin } from "./column-types.js";

export interface EventRow {
  id: string;
  name: string;
  clubName: string;
  status: "ended";
  attendanceRevision: number;
  briefingRevision: number;
  nextFeedbackNumber: number;
  feedbackPendingSince: Date | null;
}

export const EventEntity = new EntitySchema<EventRow>({
  name: "Event",
  tableName: "events",
  columns: {
    id: { type: "varchar", length: 16, primary: true, ...asciiBin },
    name: { type: "varchar", length: 120 },
    clubName: { name: "club_name", type: "varchar", length: 120 },
    status: { type: "enum", enum: ["ended"] },
    attendanceRevision: { name: "attendance_revision", type: "int", unsigned: true },
    briefingRevision: { name: "briefing_revision", type: "int", unsigned: true },
    nextFeedbackNumber: { name: "next_feedback_number", type: "int", unsigned: true },
    feedbackPendingSince: { name: "feedback_pending_since", type: "datetime", precision: 3, nullable: true },
  },
});

export interface MemberRow {
  eventId: string;
  id: string;
  name: string;
  attendance: AttendanceStatus;
  displayOrder: number;
}

export const MemberEntity = new EntitySchema<MemberRow>({
  name: "Member",
  tableName: "members",
  columns: {
    eventId: { name: "event_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    id: { type: "varchar", length: 16, primary: true, ...asciiBin },
    name: { type: "varchar", length: 120 },
    attendance: { type: "enum", enum: [...ATTENDANCE_STATUSES] },
    displayOrder: { name: "display_order", type: "smallint", unsigned: true },
  },
});

export interface FeedbackNoteRow {
  eventId: string;
  id: string;
  text: string;
  origin: "seed" | "submitted";
  submissionId: string | null;
  receivedAt: Date;
  displayOrder: number;
}

export const FeedbackNoteEntity = new EntitySchema<FeedbackNoteRow>({
  name: "FeedbackNote",
  tableName: "feedback_notes",
  columns: {
    eventId: { name: "event_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    id: { type: "varchar", length: 16, primary: true, ...asciiBin },
    text: { type: "varchar", length: 1000 },
    origin: { type: "enum", enum: ["seed", "submitted"] },
    submissionId: { name: "submission_id", type: "char", length: 36, nullable: true, ...asciiBin },
    receivedAt: { name: "received_at", type: "datetime", precision: 3 },
    displayOrder: { name: "display_order", type: "int", unsigned: true },
  },
});
```

In `persistence/entities/index.ts`, import the three entities and change the export to `export const ENTITIES: EntitySchema[] = [EventEntity, MemberEntity, FeedbackNoteEntity];`. Keep the doc comment.

`apps/event-api/src/ports/unit-of-work.ts` (T4 §7):

```ts
import type { AttendanceChange, EventId, EventSummary, FeedbackNote, Member } from "@event-desk/contracts";

/** The event row with its roster and notes, as one consistent read. */
export interface EventAggregate {
  event: EventSummary;
  attendanceRevision: number;
  briefingRevision: number;
  members: Member[];
  feedback: FeedbackNote[];
}

export interface EventReadRepository {
  findAggregate(eventId: EventId): Promise<EventAggregate | null>;
}

export interface EventWriteRepository extends EventReadRepository {
  /** `SELECT … FOR UPDATE` on the event row: the single serialisation point for writers. */
  lockForUpdate(eventId: EventId): Promise<EventAggregate>;
  /** Updates the changed members only and bumps attendance_revision by one. */
  applyAttendanceChanges(eventId: EventId, changes: readonly AttendanceChange[]): Promise<void>;
}

export interface ReadScope {
  events: EventReadRepository;
}

export interface TransactionScope extends ReadScope {
  events: EventWriteRepository;
  /** Runs only after COMMIT succeeds (cache flush, change notification). */
  afterCommit(effect: () => Promise<void>): void;
}

export interface UnitOfWork {
  /** BEGIN … COMMIT on one connection; retries nothing. */
  run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T>;
  /** START TRANSACTION READ ONLY: a consistent snapshot without locks. */
  readSnapshot<T>(work: (scope: ReadScope) => Promise<T>): Promise<T>;
}
```

- [ ] **Step 4: Implement the adapters**

`apps/event-api/src/repositories/row-parsing.ts`:

```ts
import type { z } from "zod";
import { AppError } from "../shared/app-error.js";

/** Every stored row passes a contracts schema; a failure is corruption, never silently repaired (F1). */
export function parseStoredRow<Schema extends z.ZodType>(schema: Schema, row: unknown, table: string): z.output<Schema> {
  const result = schema.safeParse(row);
  if (!result.success) {
    throw new AppError("STORE_CORRUPT", `Stored ${table} data is invalid. The store needs manual recovery.`, {
      cause: result.error,
    });
  }
  return result.data;
}

/** DATETIME(3) columns arrive as Date; anything else is passed through for the schema to reject. */
export function toIsoTimestamp(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}
```

`apps/event-api/src/repositories/store-errors.ts`:

```ts
import { AppError } from "../shared/app-error.js";

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "ER_CON_COUNT_ERROR",
  "ER_SERVER_SHUTDOWN",
]);

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("driverError" in error) return errorCode(error.driverError);
  return undefined;
}

export function isConnectionError(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && CONNECTION_ERROR_CODES.has(code);
}

export function storeUnavailable(cause: unknown): AppError {
  return new AppError("STORE_UNAVAILABLE", "The event store is unavailable. Try again shortly.", { cause });
}

/** Database failures become typed errors: connection loss is 503, anything else is 500. */
export function toStoreError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (isConnectionError(error)) return storeUnavailable(error);
  return new AppError("INTERNAL", "The event store could not complete the request.", { cause: error });
}
```

`apps/event-api/src/repositories/event-repository.ts`:

```ts
import {
  type AttendanceChange,
  type EventId,
  EventSummarySchema,
  FeedbackNoteSchema,
  MemberSchema,
} from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import { z } from "zod";
import { EventEntity, type EventRow, FeedbackNoteEntity, MemberEntity } from "../persistence/entities/event.entities.js";
import type { EventAggregate, EventWriteRepository } from "../ports/unit-of-work.js";
import { AppError } from "../shared/app-error.js";
import { parseStoredRow, toIsoTimestamp } from "./row-parsing.js";

const StoredRevisionsSchema = z.object({
  attendanceRevision: z.int().min(0),
  briefingRevision: z.int().min(0),
});

export class TypeOrmEventRepository implements EventWriteRepository {
  constructor(private readonly manager: EntityManager) {}

  async findAggregate(eventId: EventId): Promise<EventAggregate | null> {
    const row = await this.manager.findOne(EventEntity, { where: { id: eventId } });
    return row === null ? null : this.withChildren(row);
  }

  async lockForUpdate(eventId: EventId): Promise<EventAggregate> {
    const row = await this.manager
      .createQueryBuilder(EventEntity, "event")
      .setLock("pessimistic_write")
      .where("event.id = :id", { id: eventId })
      .getOne();
    if (row === null) throw new AppError("EVENT_NOT_FOUND", `Event ${eventId} was not found.`);
    return this.withChildren(row);
  }

  async applyAttendanceChanges(eventId: EventId, changes: readonly AttendanceChange[]): Promise<void> {
    for (const change of changes) {
      await this.manager.update(MemberEntity, { eventId, id: change.memberId }, { attendance: change.to });
    }
    await this.manager.increment(EventEntity, { id: eventId }, "attendanceRevision", 1);
  }

  private async withChildren(row: EventRow): Promise<EventAggregate> {
    const event = parseStoredRow(
      EventSummarySchema,
      { id: row.id, name: row.name, clubName: row.clubName, status: row.status },
      "events",
    );
    const revisions = parseStoredRow(StoredRevisionsSchema, row, "events");
    const memberRows = await this.manager.find(MemberEntity, {
      where: { eventId: event.id },
      order: { displayOrder: "ASC" },
    });
    if (memberRows.length === 0) {
      throw new AppError("STORE_CORRUPT", `Event ${event.id} has no registered members. The store needs manual recovery.`);
    }
    const noteRows = await this.manager.find(FeedbackNoteEntity, {
      where: { eventId: event.id },
      order: { displayOrder: "ASC" },
    });
    return {
      event,
      ...revisions,
      members: memberRows.map((m) =>
        parseStoredRow(MemberSchema, { id: m.id, name: m.name, attendance: m.attendance }, "members"),
      ),
      feedback: noteRows.map((n) =>
        parseStoredRow(
          FeedbackNoteSchema,
          { id: n.id, text: n.text, receivedAt: toIsoTimestamp(n.receivedAt) },
          "feedback_notes",
        ),
      ),
    };
  }
}
```

`apps/event-api/src/repositories/typeorm-unit-of-work.ts`:

```ts
import type { DataSource, EntityManager, QueryRunner } from "typeorm";
import type { ReadScope, TransactionScope, UnitOfWork } from "../ports/unit-of-work.js";
import type { Logger } from "../shared/logger.js";
import { TypeOrmEventRepository } from "./event-repository.js";
import { storeUnavailable, toStoreError } from "./store-errors.js";

type Effect = () => Promise<void>;

/** InnoDB REPEATABLE READ transactions on one pooled connection; side effects only after COMMIT (T4 §6–7). */
export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: Logger,
  ) {}

  async run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T> {
    const effects: Effect[] = [];
    const result = await this.withRunner(async (runner) => {
      await runner.startTransaction("REPEATABLE READ");
      try {
        const value = await work(this.transactionScope(runner.manager, effects));
        await runner.commitTransaction();
        return value;
      } catch (error) {
        await this.rollbackQuietly(runner);
        throw error;
      }
    });
    await this.runEffects(effects);
    return result;
  }

  async readSnapshot<T>(work: (scope: ReadScope) => Promise<T>): Promise<T> {
    return this.withRunner(async (runner) => {
      await runner.query("START TRANSACTION READ ONLY");
      try {
        const value = await work(this.readScope(runner.manager));
        await runner.query("COMMIT");
        return value;
      } catch (error) {
        await runner.query("ROLLBACK").catch((rollbackError: unknown) => {
          this.logger.warn({ err: rollbackError }, "read-only rollback failed");
        });
        throw error;
      }
    });
  }

  protected readScope(manager: EntityManager): ReadScope {
    return { events: new TypeOrmEventRepository(manager) };
  }

  protected transactionScope(manager: EntityManager, effects: Effect[]): TransactionScope {
    return {
      events: new TypeOrmEventRepository(manager),
      afterCommit: (effect) => {
        effects.push(effect);
      },
    };
  }

  private async withRunner<T>(use: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = await this.acquire();
    try {
      return await use(runner);
    } catch (error) {
      throw toStoreError(error);
    } finally {
      await runner.release();
    }
  }

  private async acquire(): Promise<QueryRunner> {
    let runner: QueryRunner | undefined;
    try {
      runner = this.dataSource.createQueryRunner();
      await runner.connect();
      return runner;
    } catch (error) {
      await runner?.release().catch(() => undefined);
      throw storeUnavailable(error);
    }
  }

  private async rollbackQuietly(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) return;
    await runner.rollbackTransaction().catch((error: unknown) => {
      this.logger.warn({ err: error }, "rollback failed");
    });
  }

  private async runEffects(effects: readonly Effect[]): Promise<void> {
    for (const effect of effects) {
      try {
        await effect();
      } catch (error) {
        this.logger.error({ err: error }, "after-commit effect failed");
      }
    }
  }
}
```

`readScope` and `transactionScope` are `protected` so Task 7 can extend them in place. Task 7 edits these two methods directly; it does not subclass.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test && pnpm test:integration`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/event-api/src
git commit -m "feat(event-api): event entities, unit of work with afterCommit, event repository" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Seed once and store bootstrap (F1, TX1)

**Files:**
- Create: `apps/event-api/src/persistence/mysql-errors.ts`, `apps/event-api/src/persistence/seed.ts`, `apps/event-api/src/persistence/store-bootstrap.ts`
- Test: `apps/event-api/src/persistence/seed.int.test.ts`

**Interfaces:**
- Consumes: `EventEntity`, `MemberEntity`, `FeedbackNoteEntity` (Task 5); `TypeOrmUnitOfWork` (Task 5, for assertions); test helpers (Task 4); contracts `SUPPLIED_*`.
- Produces:
  - `seedIfMissing(dataSource, now: Date): Promise<"seeded" | "existing">`.
  - `bootstrapStore(dataSource, logger, now): Promise<void>` (runs migrations, then the seed).
  - `isDuplicateKeyError(error): boolean`, `MYSQL_ERRNO`.

- [ ] **Step 1: Write the failing test**

`apps/event-api/src/persistence/seed.int.test.ts`:

```ts
import { deriveAttendanceCounts, SUPPLIED_EVENT, SUPPLIED_FEEDBACK, SUPPLIED_MEMBERS } from "@event-desk/contracts";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TypeOrmUnitOfWork } from "../repositories/typeorm-unit-of-work.js";
import { openTestDataSource, truncateAllTables } from "../testing/database.js";
import { silentLogger } from "../testing/test-config.js";
import { seedIfMissing } from "./seed.js";
import { bootstrapStore } from "./store-bootstrap.js";

const NOW = new Date("2026-10-03T10:00:00.000Z");
let dataSource: DataSource;
let uow: TypeOrmUnitOfWork;

const countOf = async (table: string) => {
  const [row] = await dataSource.query<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(row?.n);
};

beforeAll(async () => {
  dataSource = await openTestDataSource();
  uow = new TypeOrmUnitOfWork(dataSource, silentLogger);
});
afterAll(async () => {
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
});

describe("seedIfMissing (TX1)", () => {
  it("F1-01: initialises the exact supplied records once", async () => {
    expect(await seedIfMissing(dataSource, NOW)).toBe("seeded");
    const aggregate = await uow.readSnapshot((scope) => scope.events.findAggregate(SUPPLIED_EVENT.id));
    expect(aggregate?.event).toEqual(SUPPLIED_EVENT);
    expect(aggregate?.members).toEqual(SUPPLIED_MEMBERS);
    expect(aggregate?.feedback.map((n) => [n.id, n.text])).toEqual(SUPPLIED_FEEDBACK.map((n) => [n.id, n.text]));
    expect(deriveAttendanceCounts(aggregate?.members ?? [])).toEqual({ registered: 4, attended: 1, absent: 2, notRecorded: 1 });
    expect(aggregate?.attendanceRevision).toBe(0);
    expect(aggregate?.briefingRevision).toBe(0);
    const [event] = await dataSource.query<{ next_feedback_number: number }[]>("SELECT next_feedback_number FROM events");
    expect(event?.next_feedback_number).toBe(9);
    expect(await countOf("briefing_generations")).toBe(0);
  });

  it("F1-04: repeated starts never duplicate or overwrite saved data", async () => {
    await seedIfMissing(dataSource, NOW);
    await dataSource.query("UPDATE members SET attendance = 'attended' WHERE id = 'M03'");
    expect(await seedIfMissing(dataSource, NOW)).toBe("existing");
    expect(await countOf("events")).toBe(1);
    expect(await countOf("members")).toBe(4);
    expect(await countOf("feedback_notes")).toBe(8);
    const [chris] = await dataSource.query<{ attendance: string }[]>("SELECT attendance FROM members WHERE id = 'M03'");
    expect(chris?.attendance).toBe("attended");
  });

  it("F1-05: never reseeds over an incomplete store", async () => {
    await seedIfMissing(dataSource, NOW);
    await dataSource.query("DELETE FROM feedback_notes");
    await dataSource.query("DELETE FROM members");
    expect(await seedIfMissing(dataSource, NOW)).toBe("existing");
    expect(await countOf("members")).toBe(0);
    await expect(uow.readSnapshot((scope) => scope.events.findAggregate(SUPPLIED_EVENT.id))).rejects.toMatchObject({
      code: "STORE_CORRUPT",
    });
  });
});

describe("bootstrapStore", () => {
  it("is idempotent: migrations already applied, data already seeded", async () => {
    await bootstrapStore(dataSource, silentLogger, NOW);
    await bootstrapStore(dataSource, silentLogger, NOW);
    expect(await countOf("events")).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:integration`
Expected: FAIL. `Failed to resolve import "./seed.js"`.

- [ ] **Step 3: Implement**

`apps/event-api/src/persistence/mysql-errors.ts`:

```ts
export const MYSQL_ERRNO = {
  duplicateEntry: 1062,
  noReferencedRow: 1452,
  rowIsReferenced: 1451,
  checkConstraintViolated: 3819,
} as const;

function errnoOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("errno" in error && typeof error.errno === "number") return error.errno;
  if ("driverError" in error) return errnoOf(error.driverError);
  return undefined;
}

export function isDuplicateKeyError(error: unknown): boolean {
  return errnoOf(error) === MYSQL_ERRNO.duplicateEntry;
}
```

`apps/event-api/src/persistence/seed.ts`:

```ts
import { SUPPLIED_EVENT, SUPPLIED_FEEDBACK, SUPPLIED_MEMBERS } from "@event-desk/contracts";
import type { DataSource } from "typeorm";
import { EventEntity, FeedbackNoteEntity, MemberEntity } from "./entities/event.entities.js";
import { isDuplicateKeyError } from "./mysql-errors.js";

/**
 * TX1: initialise E101 exactly once. Seeding happens only when the event row is absent.
 * Partial or corrupt data is left untouched for recovery (F1 rule 6); it is never reseeded.
 */
export async function seedIfMissing(dataSource: DataSource, now: Date): Promise<"seeded" | "existing"> {
  try {
    return await dataSource.transaction(async (manager): Promise<"seeded" | "existing"> => {
      const existing = await manager.findOne(EventEntity, { where: { id: SUPPLIED_EVENT.id } });
      if (existing !== null) return "existing";
      await manager.insert(EventEntity, {
        id: SUPPLIED_EVENT.id,
        name: SUPPLIED_EVENT.name,
        clubName: SUPPLIED_EVENT.clubName,
        status: SUPPLIED_EVENT.status,
        attendanceRevision: 0,
        briefingRevision: 0,
        nextFeedbackNumber: SUPPLIED_FEEDBACK.length + 1,
        feedbackPendingSince: null,
      });
      await manager.insert(
        MemberEntity,
        SUPPLIED_MEMBERS.map((member, index) => ({
          eventId: SUPPLIED_EVENT.id,
          id: member.id,
          name: member.name,
          attendance: member.attendance,
          displayOrder: index + 1,
        })),
      );
      await manager.insert(
        FeedbackNoteEntity,
        SUPPLIED_FEEDBACK.map((note, index) => ({
          eventId: SUPPLIED_EVENT.id,
          id: note.id,
          text: note.text,
          origin: "seed" as const,
          submissionId: null,
          receivedAt: now,
          displayOrder: index + 1,
        })),
      );
      return "seeded";
    });
  } catch (error) {
    // Another process seeded between our check and insert: the data now exists.
    if (isDuplicateKeyError(error)) return "existing";
    throw error;
  }
}
```

`apps/event-api/src/persistence/store-bootstrap.ts`:

```ts
import type { DataSource } from "typeorm";
import type { Logger } from "../shared/logger.js";
import { seedIfMissing } from "./seed.js";

/** Startup: apply pending migrations, then seed if (and only if) E101 does not exist. */
export async function bootstrapStore(dataSource: DataSource, logger: Logger, now: Date): Promise<void> {
  const applied = await dataSource.runMigrations({ transaction: "none" });
  const seed = await seedIfMissing(dataSource, now);
  logger.info({ migrationsApplied: applied.map((m) => m.name), seed }, "event store ready");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm test:integration`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/event-api/src
git commit -m "feat(event-api): seed E101 once and bootstrap the store on startup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Briefing read model (slots, saved wording, outcomes, freshness)

**Files:**
- Create: `apps/event-api/src/persistence/entities/generation.entities.ts`, `briefing-slot.entities.ts`, `generation-outcome.entity.ts`
- Modify: `apps/event-api/src/persistence/entities/index.ts`, `apps/event-api/src/ports/unit-of-work.ts`, `apps/event-api/src/repositories/typeorm-unit-of-work.ts`
- Create: `apps/event-api/src/repositories/briefing-mapping.ts`, `briefing-read-repository.ts`, `outcome-read-repository.ts`
- Create: `apps/event-api/src/modules/briefing/briefing-views.ts`
- Test: `apps/event-api/src/repositories/briefing-mapping.test.ts`, `apps/event-api/src/modules/briefing/briefing-views.test.ts`, `apps/event-api/src/repositories/briefing-read-repository.int.test.ts`

**Interfaces:**
- Consumes: `parseStoredRow`, `toIsoTimestamp`, `TypeOrmUnitOfWork` (Task 5); SQL fixtures (Task 4). From contracts: `BriefingContentSchema`, `GenerationProvenanceSchema`, `GenerationStatusViewSchema`, `GenerationTriggerSchema`, `MemberAttendanceSchema`, `FeedbackIdSchema`, `compareFeedbackIds`, `deriveAttendanceCounts`, `computeFreshness`, `feedbackDigest`, `GENERATION_TRIGGERS`, `RUN_OUTCOME_STATUSES`, and `buildBriefingView` (testing).
- Produces:
  - Ports:
    - `StoredBriefing` (`{ provenance; trigger; content; savedAt?: string }`).
    - `BriefingSlots` (`{ saved; selected; incoming }`, each `StoredBriefing | null`).
    - `BriefingReadRepository.loadSlots(eventId)`.
    - `LastOutcome`, `OutcomeReadRepository.latest(eventId)`.
    - `ReadScope` and `TransactionScope` now also have `briefings` and `outcomes`.
  - `assembleStoredBriefing(record: GenerationRecord, saved?: SavedWording): StoredBriefing`.
  - `TypeOrmBriefingReadRepository`, `TypeOrmOutcomeReadRepository`.
  - `loadBriefingViews(scope, eventId, members, feedback): Promise<BriefingViews>` and `freshnessSummary(views)` (`modules/briefing/briefing-views.ts`). `BriefingViews` = `{ savedBriefing; selectedPreview; incomingPreview }`, each `BriefingView | null`.

- [ ] **Step 1: Add the entities**

`apps/event-api/src/persistence/entities/generation.entities.ts`:

```ts
import { ATTENDANCE_STATUSES, type AttendanceStatus, GENERATION_TRIGGERS, type GenerationTrigger } from "@event-desk/contracts";
import { EntitySchema } from "typeorm";
import { asciiBin } from "./column-types.js";

export interface GenerationRow {
  id: string;
  eventId: string;
  runId: string;
  triggerType: GenerationTrigger;
  model: string;
  promptVersion: string;
  attendanceOverview: string;
  feedbackDigest: string;
  inputCapturedAt: Date;
  generatedAt: Date;
}

export const GenerationEntity = new EntitySchema<GenerationRow>({
  name: "BriefingGeneration",
  tableName: "briefing_generations",
  columns: {
    id: { type: "char", length: 36, primary: true, ...asciiBin },
    eventId: { name: "event_id", type: "varchar", length: 16, ...asciiBin },
    runId: { name: "run_id", type: "varchar", length: 64, ...asciiBin },
    triggerType: { name: "trigger_type", type: "enum", enum: [...GENERATION_TRIGGERS] },
    model: { type: "varchar", length: 100 },
    promptVersion: { name: "prompt_version", type: "varchar", length: 32 },
    attendanceOverview: { name: "attendance_overview", type: "varchar", length: 500 },
    feedbackDigest: { name: "feedback_digest", type: "char", length: 64, ...asciiBin },
    inputCapturedAt: { name: "input_captured_at", type: "datetime", precision: 3 },
    generatedAt: { name: "generated_at", type: "datetime", precision: 3 },
  },
});

export interface AttendanceInputRow {
  generationId: string;
  eventId: string;
  memberId: string;
  attendance: AttendanceStatus;
}

export const AttendanceInputEntity = new EntitySchema<AttendanceInputRow>({
  name: "GenerationAttendanceInput",
  tableName: "generation_attendance_inputs",
  columns: {
    generationId: { name: "generation_id", type: "char", length: 36, primary: true, ...asciiBin },
    eventId: { name: "event_id", type: "varchar", length: 16, ...asciiBin },
    memberId: { name: "member_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    attendance: { type: "enum", enum: [...ATTENDANCE_STATUSES] },
  },
});

export interface FeedbackInputRow {
  generationId: string;
  eventId: string;
  feedbackId: string;
}

export const FeedbackInputEntity = new EntitySchema<FeedbackInputRow>({
  name: "GenerationFeedbackInput",
  tableName: "generation_feedback_inputs",
  columns: {
    generationId: { name: "generation_id", type: "char", length: 36, primary: true, ...asciiBin },
    eventId: { name: "event_id", type: "varchar", length: 16, ...asciiBin },
    feedbackId: { name: "feedback_id", type: "varchar", length: 16, primary: true, ...asciiBin },
  },
});

export const BRIEFING_ITEM_SECTIONS = ["summary", "theme", "conflict", "suggestion"] as const;
export type BriefingItemSection = (typeof BRIEFING_ITEM_SECTIONS)[number];

export interface BriefingItemRow {
  id: string;
  generationId: string;
  section: BriefingItemSection;
  position: number;
  text: string;
}

export const BriefingItemEntity = new EntitySchema<BriefingItemRow>({
  name: "BriefingItem",
  tableName: "briefing_items",
  columns: {
    id: { type: "char", length: 36, primary: true, ...asciiBin },
    generationId: { name: "generation_id", type: "char", length: 36, ...asciiBin },
    section: { type: "enum", enum: [...BRIEFING_ITEM_SECTIONS] },
    position: { type: "tinyint", unsigned: true },
    text: { type: "varchar", length: 1000 },
  },
});

export interface BriefingItemSourceRow {
  itemId: string;
  generationId: string;
  feedbackId: string;
  position: number;
}

export const BriefingItemSourceEntity = new EntitySchema<BriefingItemSourceRow>({
  name: "BriefingItemSource",
  tableName: "briefing_item_sources",
  columns: {
    itemId: { name: "item_id", type: "char", length: 36, primary: true, ...asciiBin },
    generationId: { name: "generation_id", type: "char", length: 36, ...asciiBin },
    feedbackId: { name: "feedback_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    position: { type: "tinyint", unsigned: true },
  },
});
```

`apps/event-api/src/persistence/entities/briefing-slot.entities.ts`:

```ts
import { EntitySchema } from "typeorm";
import { asciiBin } from "./column-types.js";

export const PREVIEW_SLOT_NAMES = ["selected", "incoming"] as const;
export type PreviewSlotName = (typeof PREVIEW_SLOT_NAMES)[number];

export interface PreviewSlotRow {
  eventId: string;
  slot: PreviewSlotName;
  generationId: string;
  updatedAt: Date;
}

export const PreviewSlotEntity = new EntitySchema<PreviewSlotRow>({
  name: "PreviewSlot",
  tableName: "preview_slots",
  columns: {
    eventId: { name: "event_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    slot: { type: "enum", enum: [...PREVIEW_SLOT_NAMES], primary: true },
    generationId: { name: "generation_id", type: "char", length: 36, ...asciiBin },
    updatedAt: { name: "updated_at", type: "datetime", precision: 3 },
  },
});

export interface SavedBriefingRow {
  eventId: string;
  generationId: string;
  attendanceOverview: string;
  savedAt: Date;
}

export const SavedBriefingEntity = new EntitySchema<SavedBriefingRow>({
  name: "SavedBriefing",
  tableName: "saved_briefings",
  columns: {
    eventId: { name: "event_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    generationId: { name: "generation_id", type: "char", length: 36, ...asciiBin },
    attendanceOverview: { name: "attendance_overview", type: "varchar", length: 500 },
    savedAt: { name: "saved_at", type: "datetime", precision: 3 },
  },
});

export interface SavedBriefingItemRow {
  eventId: string;
  generationId: string;
  itemId: string;
  text: string;
}

export const SavedBriefingItemEntity = new EntitySchema<SavedBriefingItemRow>({
  name: "SavedBriefingItem",
  tableName: "saved_briefing_items",
  columns: {
    eventId: { name: "event_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    generationId: { name: "generation_id", type: "char", length: 36, ...asciiBin },
    itemId: { name: "item_id", type: "char", length: 36, primary: true, ...asciiBin },
    text: { type: "varchar", length: 1000 },
  },
});
```

`apps/event-api/src/persistence/entities/generation-outcome.entity.ts`:

```ts
import { GENERATION_TRIGGERS, type GenerationTrigger, RUN_OUTCOME_STATUSES } from "@event-desk/contracts";
import { EntitySchema } from "typeorm";
import { asciiBin } from "./column-types.js";

export interface GenerationOutcomeRow {
  runId: string;
  eventId: string;
  triggerType: GenerationTrigger;
  status: (typeof RUN_OUTCOME_STATUSES)[number];
  errorCode: string | null;
  generationId: string | null;
  finishedAt: Date;
}

export const GenerationOutcomeEntity = new EntitySchema<GenerationOutcomeRow>({
  name: "GenerationOutcome",
  tableName: "generation_outcomes",
  columns: {
    runId: { name: "run_id", type: "varchar", length: 64, primary: true, ...asciiBin },
    eventId: { name: "event_id", type: "varchar", length: 16, ...asciiBin },
    triggerType: { name: "trigger_type", type: "enum", enum: [...GENERATION_TRIGGERS] },
    status: { type: "enum", enum: [...RUN_OUTCOME_STATUSES] },
    errorCode: { name: "error_code", type: "varchar", length: 40, nullable: true, ...asciiBin },
    generationId: { name: "generation_id", type: "char", length: 36, nullable: true, ...asciiBin },
    finishedAt: { name: "finished_at", type: "datetime", precision: 3 },
  },
});
```

In `persistence/entities/index.ts`, import the nine new entities and list all twelve in `ENTITIES`, in this order: event entities, generation entities, slot entities, outcome entity.

- [ ] **Step 2: Extend the ports**

In `apps/event-api/src/ports/unit-of-work.ts`:
- Extend the import to `import type { AttendanceChange, BriefingContent, EventId, EventSummary, FeedbackNote, GenerationProvenance, GenerationStatusView, GenerationTrigger, Member } from "@event-desk/contracts";`.
- Add these declarations after `EventWriteRepository`:

```ts
/** A briefing as stored: generated structure and references, with saved wording when it is the saved one. */
export interface StoredBriefing {
  provenance: GenerationProvenance;
  trigger: GenerationTrigger;
  content: BriefingContent;
  savedAt?: string;
}

export interface BriefingSlots {
  saved: StoredBriefing | null;
  selected: StoredBriefing | null;
  incoming: StoredBriefing | null;
}

export interface BriefingReadRepository {
  loadSlots(eventId: EventId): Promise<BriefingSlots>;
}

export type LastOutcome = NonNullable<GenerationStatusView["lastOutcome"]>;

export interface OutcomeReadRepository {
  latest(eventId: EventId): Promise<LastOutcome | null>;
}
```

- Replace `ReadScope` with:

```ts
export interface ReadScope {
  events: EventReadRepository;
  briefings: BriefingReadRepository;
  outcomes: OutcomeReadRepository;
}
```

- [ ] **Step 3: Write the failing tests**

`apps/event-api/src/repositories/briefing-mapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BriefingItemRow, BriefingItemSection, BriefingItemSourceRow } from "../persistence/entities/generation.entities.js";
import { assembleStoredBriefing, type GenerationRecord } from "./briefing-mapping.js";

const GEN = "0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f";
const AT = new Date("2026-10-03T09:00:00.000Z");

const item = (id: string, section: BriefingItemSection, position: number, text: string): BriefingItemRow => ({
  id,
  generationId: GEN,
  section,
  position,
  text,
});
const source = (itemId: string, feedbackId: string, position: number): BriefingItemSourceRow => ({
  itemId,
  generationId: GEN,
  feedbackId,
  position,
});

function record(overrides: Partial<GenerationRecord> = {}): GenerationRecord {
  return {
    generation: {
      id: GEN,
      eventId: "E101",
      runId: "manual:fixture",
      triggerType: "manual",
      model: "fixture-model",
      promptVersion: "briefing-v1",
      attendanceOverview: "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
      feedbackDigest: "a".repeat(64),
      inputCapturedAt: AT,
      generatedAt: AT,
    },
    attendanceInputs: [
      { generationId: GEN, eventId: "E101", memberId: "M02", attendance: "absent" },
      { generationId: GEN, eventId: "E101", memberId: "M01", attendance: "attended" },
      { generationId: GEN, eventId: "E101", memberId: "M04", attendance: "absent" },
      { generationId: GEN, eventId: "E101", memberId: "M03", attendance: "not_recorded" },
    ],
    feedbackInputs: ["F10", "F09", "F02", "F01"].map((feedbackId) => ({ generationId: GEN, eventId: "E101", feedbackId })),
    items: [
      item("i-suggest", "suggestion", 0, "Consider reviewing the route length."),
      item("i-theme-1", "theme", 1, "Second theme."),
      item("i-summary", "summary", 0, "Summary."),
      item("i-theme-0", "theme", 0, "First theme."),
    ],
    sources: [
      source("i-summary", "F02", 1),
      source("i-summary", "F01", 0),
      source("i-theme-0", "F01", 0),
      source("i-theme-0", "F02", 1),
      source("i-theme-1", "F09", 0),
      source("i-theme-1", "F10", 1),
      source("i-suggest", "F10", 0),
    ],
    ...overrides,
  };
}

describe("assembleStoredBriefing", () => {
  it("orders sections and citations and derives the captured counts (T4 §5)", () => {
    const briefing = assembleStoredBriefing(record());
    expect(briefing.content).toEqual({
      attendanceOverview: "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
      feedbackSummary: { text: "Summary.", sourceIds: ["F01", "F02"] },
      themes: [
        { text: "First theme.", sourceIds: ["F01", "F02"] },
        { text: "Second theme.", sourceIds: ["F09", "F10"] },
      ],
      conflicts: [],
      suggestions: [{ text: "Consider reviewing the route length.", sourceIds: ["F10"] }],
    });
    expect(briefing.provenance.input.attendance.map((a) => a.memberId)).toEqual(["M01", "M02", "M03", "M04"]);
    expect(briefing.provenance.input.counts).toEqual({ registered: 4, attended: 1, absent: 2, notRecorded: 1 });
    expect(briefing.provenance.input.feedbackIds).toEqual(["F01", "F02", "F09", "F10"]);
    expect(briefing.provenance.generatedAt).toBe("2026-10-03T09:00:00.000Z");
    expect(briefing.trigger).toBe("manual");
    expect(briefing.savedAt).toBeUndefined();
  });

  it("uses saved wording and overview but keeps the generated references (D2)", () => {
    const briefing = assembleStoredBriefing(record(), {
      attendanceOverview: "Edited overview.",
      savedAt: AT,
      itemTexts: new Map([
        ["i-summary", "Edited summary."],
        ["i-theme-0", "Edited first."],
        ["i-theme-1", "Edited second."],
        ["i-suggest", "Edited suggestion."],
      ]),
    });
    expect(briefing.content.attendanceOverview).toBe("Edited overview.");
    expect(briefing.content.feedbackSummary).toEqual({ text: "Edited summary.", sourceIds: ["F01", "F02"] });
    expect(briefing.content.themes[1]).toEqual({ text: "Edited second.", sourceIds: ["F09", "F10"] });
    expect(briefing.savedAt).toBe("2026-10-03T09:00:00.000Z");
  });

  it("reports a saved briefing with a missing item text as STORE_CORRUPT", () => {
    expect(() =>
      assembleStoredBriefing(record(), { attendanceOverview: "x", savedAt: AT, itemTexts: new Map() }),
    ).toThrow(expect.objectContaining({ code: "STORE_CORRUPT" }));
  });

  it("requires exactly one feedback summary", () => {
    const noSummary = record({ items: record().items.filter((i) => i.section !== "summary") });
    expect(() => assembleStoredBriefing(noSummary)).toThrow(expect.objectContaining({ code: "STORE_CORRUPT" }));
  });

  it("rejects stored IDs that are not exact feedback IDs", () => {
    const lowercase = record({ sources: [...record().sources, source("i-suggest", "f01", 1)] });
    expect(() => assembleStoredBriefing(lowercase)).toThrow(expect.objectContaining({ code: "STORE_CORRUPT" }));
  });
});
```

`apps/event-api/src/modules/briefing/briefing-views.test.ts`:

```ts
import {
  type FeedbackNote,
  FeedbackIdSchema,
  type Member,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import type { BriefingSlots, StoredBriefing } from "../../ports/unit-of-work.js";
import { freshnessSummary, loadBriefingViews } from "./briefing-views.js";

const { freshness: _ignored, ...stored } = buildBriefingView();
const storedBriefing: StoredBriefing = stored;
const notes: FeedbackNote[] = SUPPLIED_FEEDBACK.map((note) => ({ ...note, receivedAt: FIXTURE_TIME }));

const scopeWith = (slots: BriefingSlots) => ({ briefings: { loadSlots: () => Promise.resolve(slots) } });
const withChris = (attendance: Member["attendance"]): Member[] =>
  SUPPLIED_MEMBERS.map((m) => (m.id === "M03" ? { ...m, attendance } : m));

describe("loadBriefingViews", () => {
  it("returns nulls when no briefing exists", async () => {
    const views = await loadBriefingViews(scopeWith({ saved: null, selected: null, incoming: null }), SUPPLIED_EVENT.id, SUPPLIED_MEMBERS, notes);
    expect(views).toEqual({ savedBriefing: null, selectedPreview: null, incomingPreview: null });
  });

  it("marks a briefing current when saved records match its snapshot", async () => {
    const views = await loadBriefingViews(scopeWith({ saved: storedBriefing, selected: null, incoming: null }), SUPPLIED_EVENT.id, SUPPLIED_MEMBERS, notes);
    expect(views.savedBriefing?.freshness).toEqual({ current: true, attendanceChanges: [], newFeedbackIds: [] });
    expect(views.savedBriefing?.content).toEqual(storedBriefing.content);
  });

  it("names the attendance change that made it stale (F6)", async () => {
    const views = await loadBriefingViews(scopeWith({ saved: null, selected: null, incoming: storedBriefing }), SUPPLIED_EVENT.id, withChris("attended"), notes);
    expect(views.incomingPreview?.freshness).toEqual({
      current: false,
      attendanceChanges: [{ memberId: "M03", from: "not_recorded", to: "attended" }],
      newFeedbackIds: [],
    });
  });

  it("lists notes added since the briefing", async () => {
    const withNewNote: FeedbackNote[] = [...notes, { id: FeedbackIdSchema.parse("F09"), text: "Lovely views.", receivedAt: FIXTURE_TIME }];
    const views = await loadBriefingViews(scopeWith({ saved: null, selected: storedBriefing, incoming: null }), SUPPLIED_EVENT.id, SUPPLIED_MEMBERS, withNewNote);
    expect(views.selectedPreview?.freshness.newFeedbackIds).toEqual(["F09"]);
    expect(views.selectedPreview?.freshness.current).toBe(false);
  });

  it("summarises freshness per slot for the attendance response", async () => {
    const views = await loadBriefingViews(scopeWith({ saved: storedBriefing, selected: null, incoming: null }), SUPPLIED_EVENT.id, SUPPLIED_MEMBERS, notes);
    expect(freshnessSummary(views)).toEqual({
      savedBriefing: { current: true, attendanceChanges: [], newFeedbackIds: [] },
      selectedPreview: null,
      incomingPreview: null,
    });
  });
});
```

`apps/event-api/src/repositories/briefing-read-repository.int.test.ts`:

```ts
import { SUPPLIED_EVENT } from "@event-desk/contracts";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openTestDataSource, truncateAllTables } from "../testing/database.js";
import {
  DEFAULT_ITEMS,
  GENERATION_FIXTURE_ID,
  insertEventFixture,
  insertGenerationFixture,
  insertOutcome,
  insertSavedBriefing,
  OTHER_GENERATION_FIXTURE_ID,
  putPreviewSlot,
} from "../testing/sql-fixtures.js";
import { silentLogger } from "../testing/test-config.js";
import { TypeOrmUnitOfWork } from "./typeorm-unit-of-work.js";

const E101 = SUPPLIED_EVENT.id;
let dataSource: DataSource;
let uow: TypeOrmUnitOfWork;

beforeAll(async () => {
  dataSource = await openTestDataSource();
  uow = new TypeOrmUnitOfWork(dataSource, silentLogger);
});
afterAll(async () => {
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await insertEventFixture(dataSource);
});

const loadSlots = () => uow.readSnapshot((scope) => scope.briefings.loadSlots(E101));

describe("TypeOrmBriefingReadRepository", () => {
  it("returns empty slots when nothing was generated", async () => {
    expect(await loadSlots()).toEqual({ saved: null, selected: null, incoming: null });
  });

  it("maps an incoming generation with its references", async () => {
    await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", GENERATION_FIXTURE_ID);
    const slots = await loadSlots();
    expect(slots.saved).toBeNull();
    expect(slots.selected).toBeNull();
    expect(slots.incoming?.provenance.generationId).toBe(GENERATION_FIXTURE_ID);
    expect(slots.incoming?.content.feedbackSummary.sourceIds).toEqual(["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"]);
    expect(slots.incoming?.content.themes).toEqual([{ text: "Requests for more rest-break time.", sourceIds: ["F05", "F06"] }]);
    expect(slots.incoming?.provenance.input.counts).toEqual({ registered: 4, attended: 1, absent: 2, notRecorded: 1 });
  });

  it("maps the saved briefing's human wording alongside a separate selected preview", async () => {
    await insertGenerationFixture(dataSource);
    await insertGenerationFixture(dataSource, {
      id: OTHER_GENERATION_FIXTURE_ID,
      items: DEFAULT_ITEMS.map((item, i) => ({ ...item, id: `0199a4e8-0000-7000-8000-00000000010${i}` })),
    });
    await insertSavedBriefing(dataSource, {
      generationId: GENERATION_FIXTURE_ID,
      attendanceOverview: "Edited overview.",
      itemTexts: Object.fromEntries(DEFAULT_ITEMS.map((item) => [item.id, `Edited: ${item.text}`])),
    });
    await putPreviewSlot(dataSource, "selected", OTHER_GENERATION_FIXTURE_ID);
    const slots = await loadSlots();
    expect(slots.saved?.content.attendanceOverview).toBe("Edited overview.");
    expect(slots.saved?.content.themes[0]).toEqual({ text: "Edited: Requests for more rest-break time.", sourceIds: ["F05", "F06"] });
    expect(slots.saved?.savedAt).toBe("2026-10-03T09:00:00.000Z");
    expect(slots.selected?.provenance.generationId).toBe(OTHER_GENERATION_FIXTURE_ID);
    expect(slots.selected?.content.themes[0]?.text).toBe("Requests for more rest-break time.");
  });
});

describe("TypeOrmOutcomeReadRepository", () => {
  it("returns the most recent outcome, with its code when it failed", async () => {
    expect(await uow.readSnapshot((scope) => scope.outcomes.latest(E101))).toBeNull();
    await insertOutcome(dataSource, { runId: "1", trigger: "feedback_batch", status: "skipped", finishedAt: new Date("2026-10-03T09:00:00.000Z") });
    await insertOutcome(dataSource, {
      runId: "2",
      trigger: "feedback_batch",
      status: "failed",
      errorCode: "GATEWAY_UNAVAILABLE",
      finishedAt: new Date("2026-10-03T09:05:00.000Z"),
    });
    expect(await uow.readSnapshot((scope) => scope.outcomes.latest(E101))).toEqual({
      runId: "2",
      trigger: "feedback_batch",
      status: "failed",
      code: "GATEWAY_UNAVAILABLE",
      finishedAt: "2026-10-03T09:05:00.000Z",
    });
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `pnpm test && pnpm test:integration`
Expected: FAIL. `Failed to resolve import "./briefing-mapping.js"` and `"./briefing-views.js"`, and the integration tests fail on `scope.briefings` being undefined.

- [ ] **Step 5: Implement the mapping and repositories**

`apps/event-api/src/repositories/briefing-mapping.ts`:

```ts
import {
  BriefingContentSchema,
  compareFeedbackIds,
  deriveAttendanceCounts,
  FeedbackIdSchema,
  GenerationProvenanceSchema,
  GenerationTriggerSchema,
  MemberAttendanceSchema,
} from "@event-desk/contracts";
import { z } from "zod";
import type {
  AttendanceInputRow,
  BriefingItemRow,
  BriefingItemSection,
  BriefingItemSourceRow,
  FeedbackInputRow,
  GenerationRow,
} from "../persistence/entities/generation.entities.js";
import type { StoredBriefing } from "../ports/unit-of-work.js";
import { AppError } from "../shared/app-error.js";
import { parseStoredRow, toIsoTimestamp } from "./row-parsing.js";

export interface GenerationRecord {
  generation: GenerationRow;
  attendanceInputs: readonly AttendanceInputRow[];
  feedbackInputs: readonly FeedbackInputRow[];
  items: readonly BriefingItemRow[];
  sources: readonly BriefingItemSourceRow[];
}

/** Human wording from saved_briefings / saved_briefing_items. References stay the generation's (D2). */
export interface SavedWording {
  attendanceOverview: string;
  savedAt: Date;
  itemTexts: ReadonlyMap<string, string>;
}

const SECTION_ORDER: Record<BriefingItemSection, number> = { summary: 0, theme: 1, conflict: 2, suggestion: 3 };

const corrupt = (detail: string) =>
  new AppError("STORE_CORRUPT", `Stored briefing is inconsistent (${detail}). The store needs manual recovery.`);

/** Rebuilds BriefingContent and provenance from normalised rows; counts are derived, never stored (T4 §5). */
export function assembleStoredBriefing(record: GenerationRecord, saved?: SavedWording): StoredBriefing {
  const { generation } = record;
  const sourcesByItem = new Map<string, BriefingItemSourceRow[]>();
  for (const source of record.sources) {
    sourcesByItem.set(source.itemId, [...(sourcesByItem.get(source.itemId) ?? []), source]);
  }

  const textOf = (item: BriefingItemRow): string => {
    if (saved === undefined) return item.text;
    const text = saved.itemTexts.get(item.id);
    if (text === undefined) throw corrupt(`no saved wording for item ${item.id}`);
    return text;
  };
  const toEvidence = (item: BriefingItemRow): { text: string; sourceIds: string[] } => ({
    text: textOf(item),
    sourceIds: (sourcesByItem.get(item.id) ?? [])
      .toSorted((a, b) => a.position - b.position)
      .map((source) => source.feedbackId),
  });

  const ordered = record.items.toSorted(
    (a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section] || a.position - b.position,
  );
  const summaries = ordered.filter((item) => item.section === "summary");
  const [summary] = summaries;
  if (summaries.length !== 1 || summary === undefined) {
    throw corrupt(`generation ${generation.id} has ${summaries.length} feedback summaries`);
  }
  const listOf = (section: BriefingItemSection): { text: string; sourceIds: string[] }[] =>
    ordered.filter((item) => item.section === section).map(toEvidence);

  const content = parseStoredRow(
    BriefingContentSchema,
    {
      attendanceOverview: saved?.attendanceOverview ?? generation.attendanceOverview,
      feedbackSummary: toEvidence(summary),
      themes: listOf("theme"),
      conflicts: listOf("conflict"),
      suggestions: listOf("suggestion"),
    },
    "briefing_items",
  );

  const attendance = parseStoredRow(
    z.array(MemberAttendanceSchema),
    record.attendanceInputs.map((row) => ({ memberId: row.memberId, attendance: row.attendance })),
    "generation_attendance_inputs",
  ).toSorted((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0));
  const feedbackIds = parseStoredRow(
    z.array(FeedbackIdSchema),
    record.feedbackInputs.map((row) => row.feedbackId),
    "generation_feedback_inputs",
  ).toSorted(compareFeedbackIds);

  const provenance = parseStoredRow(
    GenerationProvenanceSchema,
    {
      generationId: generation.id,
      runId: generation.runId,
      generatedAt: toIsoTimestamp(generation.generatedAt),
      model: generation.model,
      promptVersion: generation.promptVersion,
      input: {
        attendance,
        counts: deriveAttendanceCounts(attendance),
        feedbackIds,
        feedbackDigest: generation.feedbackDigest,
      },
    },
    "briefing_generations",
  );

  return {
    provenance,
    trigger: parseStoredRow(GenerationTriggerSchema, generation.triggerType, "briefing_generations"),
    content,
    ...(saved === undefined ? {} : { savedAt: saved.savedAt.toISOString() }),
  };
}
```

`apps/event-api/src/repositories/briefing-read-repository.ts`:

```ts
import type { EventId } from "@event-desk/contracts";
import { type EntityManager, In } from "typeorm";
import {
  PreviewSlotEntity,
  type PreviewSlotName,
  SavedBriefingEntity,
  SavedBriefingItemEntity,
} from "../persistence/entities/briefing-slot.entities.js";
import {
  AttendanceInputEntity,
  BriefingItemEntity,
  BriefingItemSourceEntity,
  FeedbackInputEntity,
  GenerationEntity,
} from "../persistence/entities/generation.entities.js";
import type { BriefingReadRepository, BriefingSlots, StoredBriefing } from "../ports/unit-of-work.js";
import { AppError } from "../shared/app-error.js";
import { assembleStoredBriefing, type GenerationRecord } from "./briefing-mapping.js";

const EMPTY_SLOTS: BriefingSlots = { saved: null, selected: null, incoming: null };

/** Set-based reads (never N+1): slots and saved row, referenced generations, their inputs, items and sources. */
export class TypeOrmBriefingReadRepository implements BriefingReadRepository {
  constructor(private readonly manager: EntityManager) {}

  async loadSlots(eventId: EventId): Promise<BriefingSlots> {
    const slotRows = await this.manager.find(PreviewSlotEntity, { where: { eventId } });
    const savedRow = await this.manager.findOne(SavedBriefingEntity, { where: { eventId } });
    const ids = [...new Set([...slotRows.map((s) => s.generationId), ...(savedRow ? [savedRow.generationId] : [])])];
    if (ids.length === 0) return EMPTY_SLOTS;

    const records = await this.loadRecords(ids);
    const recordFor = (generationId: string): GenerationRecord => {
      const record = records.get(generationId);
      if (record === undefined) {
        throw new AppError("STORE_CORRUPT", `Generation ${generationId} is referenced but missing. The store needs manual recovery.`);
      }
      return record;
    };
    const slot = (name: PreviewSlotName): StoredBriefing | null => {
      const row = slotRows.find((s) => s.slot === name);
      return row === undefined ? null : assembleStoredBriefing(recordFor(row.generationId));
    };

    let saved: StoredBriefing | null = null;
    if (savedRow !== null) {
      const textRows = await this.manager.find(SavedBriefingItemEntity, { where: { eventId } });
      saved = assembleStoredBriefing(recordFor(savedRow.generationId), {
        attendanceOverview: savedRow.attendanceOverview,
        savedAt: savedRow.savedAt,
        itemTexts: new Map(textRows.map((row) => [row.itemId, row.text])),
      });
    }
    return { saved, selected: slot("selected"), incoming: slot("incoming") };
  }

  private async loadRecords(ids: string[]): Promise<Map<string, GenerationRecord>> {
    const byGeneration = { generationId: In(ids) };
    const generations = await this.manager.find(GenerationEntity, { where: { id: In(ids) } });
    const attendanceInputs = await this.manager.find(AttendanceInputEntity, { where: byGeneration });
    const feedbackInputs = await this.manager.find(FeedbackInputEntity, { where: byGeneration });
    const items = await this.manager.find(BriefingItemEntity, { where: byGeneration });
    const sources = await this.manager.find(BriefingItemSourceEntity, { where: byGeneration });
    return new Map(
      generations.map((generation) => [
        generation.id,
        {
          generation,
          attendanceInputs: attendanceInputs.filter((row) => row.generationId === generation.id),
          feedbackInputs: feedbackInputs.filter((row) => row.generationId === generation.id),
          items: items.filter((row) => row.generationId === generation.id),
          sources: sources.filter((row) => row.generationId === generation.id),
        },
      ]),
    );
  }
}
```

`apps/event-api/src/repositories/outcome-read-repository.ts`:

```ts
import { type EventId, GenerationStatusViewSchema } from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import { GenerationOutcomeEntity } from "../persistence/entities/generation-outcome.entity.js";
import type { LastOutcome, OutcomeReadRepository } from "../ports/unit-of-work.js";
import { parseStoredRow, toIsoTimestamp } from "./row-parsing.js";

const LastOutcomeSchema = GenerationStatusViewSchema.shape.lastOutcome.unwrap();

export class TypeOrmOutcomeReadRepository implements OutcomeReadRepository {
  constructor(private readonly manager: EntityManager) {}

  async latest(eventId: EventId): Promise<LastOutcome | null> {
    const row = await this.manager.findOne(GenerationOutcomeEntity, {
      where: { eventId },
      order: { finishedAt: "DESC", runId: "DESC" },
    });
    if (row === null) return null;
    return parseStoredRow(
      LastOutcomeSchema,
      {
        runId: row.runId,
        trigger: row.triggerType,
        status: row.status,
        ...(row.errorCode === null ? {} : { code: row.errorCode }),
        finishedAt: toIsoTimestamp(row.finishedAt),
      },
      "generation_outcomes",
    );
  }
}
```

In `repositories/typeorm-unit-of-work.ts`, import the two new repositories and return them from both scope builders:

```ts
  protected readScope(manager: EntityManager): ReadScope {
    return {
      events: new TypeOrmEventRepository(manager),
      briefings: new TypeOrmBriefingReadRepository(manager),
      outcomes: new TypeOrmOutcomeReadRepository(manager),
    };
  }

  protected transactionScope(manager: EntityManager, effects: Effect[]): TransactionScope {
    return {
      events: new TypeOrmEventRepository(manager),
      briefings: new TypeOrmBriefingReadRepository(manager),
      outcomes: new TypeOrmOutcomeReadRepository(manager),
      afterCommit: (effect) => {
        effects.push(effect);
      },
    };
  }
```

- [ ] **Step 6: Implement the briefing views**

`apps/event-api/src/modules/briefing/briefing-views.ts`:

```ts
import {
  type BriefingView,
  computeFreshness,
  type EventId,
  type FeedbackNote,
  feedbackDigest,
  type Freshness,
  type Member,
} from "@event-desk/contracts";
import type { ReadScope, StoredBriefing } from "../../ports/unit-of-work.js";

export interface BriefingViews {
  savedBriefing: BriefingView | null;
  selectedPreview: BriefingView | null;
  incomingPreview: BriefingView | null;
}

/**
 * Loads the three briefing slots and computes each one's freshness against the given saved
 * records (D5). Shared by the event read and the attendance save so the rule exists once.
 */
export async function loadBriefingViews(
  scope: Pick<ReadScope, "briefings">,
  eventId: EventId,
  members: readonly Member[],
  feedback: readonly FeedbackNote[],
): Promise<BriefingViews> {
  const slots = await scope.briefings.loadSlots(eventId);
  if (slots.saved === null && slots.selected === null && slots.incoming === null) {
    return { savedBriefing: null, selectedPreview: null, incomingPreview: null };
  }
  const current = {
    members,
    feedbackIds: feedback.map((note) => note.id),
    feedbackDigest: await feedbackDigest(feedback),
  };
  const toView = (stored: StoredBriefing | null): BriefingView | null =>
    stored === null ? null : { ...stored, freshness: computeFreshness(stored.provenance.input, current) };
  return {
    savedBriefing: toView(slots.saved),
    selectedPreview: toView(slots.selected),
    incomingPreview: toView(slots.incoming),
  };
}

export function freshnessSummary(views: BriefingViews): Record<keyof BriefingViews, Freshness | null> {
  return {
    savedBriefing: views.savedBriefing?.freshness ?? null,
    selectedPreview: views.selectedPreview?.freshness ?? null,
    incomingPreview: views.incomingPreview?.freshness ?? null,
  };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test && pnpm test:integration`
Expected: PASS.

- [ ] **Step 8: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/event-api/src
git commit -m "feat(event-api): briefing read model with saved wording, outcomes and freshness" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Versioned event-view cache and change publishing (T3 §7)

**Files:**
- Create: `apps/event-api/src/ports/event-view-cache.ts`, `change-notifier.ts`, `clock.ts`
- Create: `apps/event-api/src/integrations/redis-keys.ts`, `redis-client.ts`, `redis-event-view-cache.ts`, `delete-keys-by-prefix.ts`, `system-clock.ts`
- Create: `apps/event-api/src/modules/changes/cache-bypass.ts`, `in-process-change-notifier.ts`, `event-change-publisher.ts`
- Create: `apps/event-api/src/modules/event/domain/cache-ttl.ts`
- Create: `apps/event-api/src/testing/redis.ts`
- Test: `apps/event-api/src/modules/event/domain/cache-ttl.test.ts`, `apps/event-api/src/modules/changes/event-change-publisher.test.ts`, `apps/event-api/src/modules/changes/in-process-change-notifier.test.ts`, `apps/event-api/src/integrations/redis-event-view-cache.int.test.ts`, `apps/event-api/src/integrations/delete-keys-by-prefix.int.test.ts`

**Interfaces:**
- Consumes: `Logger` and `createLogger` (Task 1); `silentLogger` and `testRedisUrl` (Task 4). From contracts: `EventView`, `EventViewSchema`, `EventId`, and `buildSeedEventView` (testing).
- Produces:
  - Ports:
    - `EventViewCache` (`lookup(eventId): Promise<CachedEventView>`, `store(eventId, version, view, ttlMs)`, `invalidate(eventId): Promise<number>`), `CachedEventView` (`{ version: number; view: EventView | null }`).
    - `ChangeNotifier` (`notify(eventId)`, `subscribe(listener): () => void`), `ChangeListener`.
    - `Clock` (`now(): Date`).
  - Redis integration:
    - Key constants: `EVENT_DESK_KEY_PREFIX`, `BRIEFING_BATCH_KEY_PREFIX`, `APPLICATION_KEY_PREFIXES`, `eventViewVersionKey(id)`, `eventViewKey(id, version)`.
    - `createRedisClient(url, logger): Redis`.
    - `RedisEventViewCache(redis, logger)`.
    - `deleteKeysByPrefix(redis, prefix): Promise<number>`.
    - `systemClock`.
  - Change publishing: `CacheBypass` (`active`, `activate()`, `clear()`), `InProcessChangeNotifier(logger)`, and `EventChangePublisher(cache, bypass, notifier, logger)` with `publish(eventId): Promise<void>` (never throws).
  - `cacheTtlMs(view, now, defaultTtlMs): number`.
  - Test helpers `openTestRedis()` and `clearApplicationKeys(redis)`.

- [ ] **Step 1: Write the ports**

`apps/event-api/src/ports/event-view-cache.ts`:

```ts
import type { EventId, EventView } from "@event-desk/contracts";

/** The version read before the database read, and the cached view at that version if any. */
export interface CachedEventView {
  version: number;
  view: EventView | null;
}

/** Versioned cache of the single event read (T3 §7). MySQL stays authoritative. */
export interface EventViewCache {
  lookup(eventId: EventId): Promise<CachedEventView>;
  /** Stores at the version observed by lookup(); a late store lands on a retired version. */
  store(eventId: EventId, version: number, view: EventView, ttlMs: number): Promise<void>;
  /** INCR the version, then DEL the old entry. Returns the new version. */
  invalidate(eventId: EventId): Promise<number>;
}
```

`apps/event-api/src/ports/change-notifier.ts`:

```ts
import type { EventId } from "@event-desk/contracts";

export type ChangeListener = (eventId: EventId) => void;

/** In-process "the event view changed" signal; Plan 5's SSE stream subscribes to it. */
export interface ChangeNotifier {
  notify(eventId: EventId): void;
  subscribe(listener: ChangeListener): () => void;
}
```

`apps/event-api/src/ports/clock.ts`:

```ts
export interface Clock {
  now(): Date;
}
```

- [ ] **Step 2: Write the failing tests**

`apps/event-api/src/modules/event/domain/cache-ttl.test.ts`:

```ts
import { buildSeedEventView } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import { cacheTtlMs } from "./cache-ttl.js";

const NOW = new Date("2026-10-03T09:00:00.000Z");
const withGeneration = (closesAt: string | undefined, cooldownUntil: string | null) =>
  buildSeedEventView({
    generation: {
      manual: null,
      batch: closesAt === undefined ? null : { state: "collecting", jobId: "7", closesAt, newNoteIds: [] },
      lastOutcome: null,
      cooldownUntil,
    },
  });

describe("cacheTtlMs", () => {
  it("uses the default TTL when nothing is time-driven", () => {
    expect(cacheTtlMs(buildSeedEventView(), NOW, 30_000)).toBe(30_000);
  });

  it("caps the TTL at the batch cutoff", () => {
    expect(cacheTtlMs(withGeneration("2026-10-03T09:00:02.500Z", null), NOW, 30_000)).toBe(2_500);
  });

  it("takes the earliest time-driven change", () => {
    expect(cacheTtlMs(withGeneration("2026-10-03T09:00:05.000Z", "2026-10-03T09:00:01.000Z"), NOW, 30_000)).toBe(1_000);
  });

  it("returns 0 when a deadline has already passed, so nothing is cached", () => {
    expect(cacheTtlMs(withGeneration("2026-10-03T08:59:59.000Z", null), NOW, 30_000)).toBe(0);
  });
});
```

`apps/event-api/src/modules/changes/event-change-publisher.test.ts`:

```ts
import { type EventId, EventIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import type { CachedEventView, EventViewCache } from "../../ports/event-view-cache.js";
import { createLogger } from "../../shared/logger.js";
import { CacheBypass } from "./cache-bypass.js";
import { EventChangePublisher } from "./event-change-publisher.js";
import { InProcessChangeNotifier } from "./in-process-change-notifier.js";

const E101 = EventIdSchema.parse("E101");

class FakeCache implements EventViewCache {
  failing = false;
  invalidations = 0;
  lookup(): Promise<CachedEventView> {
    return Promise.resolve({ version: 0, view: null });
  }
  store(): Promise<void> {
    return Promise.resolve();
  }
  invalidate(): Promise<number> {
    this.invalidations += 1;
    return this.failing ? Promise.reject(new Error("redis down")) : Promise.resolve(this.invalidations);
  }
}

function setup() {
  const lines: string[] = [];
  const logger = createLogger("info", { write: (chunk: string) => void lines.push(chunk) });
  const cache = new FakeCache();
  const bypass = new CacheBypass();
  const notifier = new InProcessChangeNotifier(logger);
  const notified: EventId[] = [];
  notifier.subscribe((eventId) => notified.push(eventId));
  return { cache, bypass, notified, lines, publisher: new EventChangePublisher(cache, bypass, notifier, logger) };
}

describe("EventChangePublisher", () => {
  it("flushes the cache and notifies", async () => {
    const { cache, bypass, notified, publisher } = setup();
    await publisher.publish(E101);
    expect(cache.invalidations).toBe(1);
    expect(bypass.active).toBe(false);
    expect(notified).toEqual([E101]);
  });

  it("switches reads to MySQL when the flush fails, still notifies, never throws", async () => {
    const { cache, bypass, notified, lines, publisher } = setup();
    cache.failing = true;
    await expect(publisher.publish(E101)).resolves.toBeUndefined();
    expect(bypass.active).toBe(true);
    expect(notified).toEqual([E101]);
    expect(lines.join("")).toContain("cache flush failed");
  });

  it("returns to the cache once a later flush succeeds", async () => {
    const { cache, bypass, publisher } = setup();
    cache.failing = true;
    await publisher.publish(E101);
    cache.failing = false;
    await publisher.publish(E101);
    expect(bypass.active).toBe(false);
  });
});
```

`apps/event-api/src/modules/changes/in-process-change-notifier.test.ts`:

```ts
import { type EventId, EventIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../shared/logger.js";
import { InProcessChangeNotifier } from "./in-process-change-notifier.js";

const E101 = EventIdSchema.parse("E101");

describe("InProcessChangeNotifier", () => {
  it("delivers to subscribers until they unsubscribe", () => {
    const notifier = new InProcessChangeNotifier(createLogger("silent"));
    const seen: EventId[] = [];
    const unsubscribe = notifier.subscribe((eventId) => seen.push(eventId));
    notifier.notify(E101);
    unsubscribe();
    notifier.notify(E101);
    expect(seen).toEqual([E101]);
  });

  it("isolates a failing listener from the others", () => {
    const notifier = new InProcessChangeNotifier(createLogger("silent"));
    const seen: EventId[] = [];
    notifier.subscribe(() => {
      throw new Error("listener bug");
    });
    notifier.subscribe((eventId) => seen.push(eventId));
    notifier.notify(E101);
    expect(seen).toEqual([E101]);
  });
});
```

`apps/event-api/src/testing/redis.ts`:

```ts
import { once } from "node:events";
import type { Redis } from "ioredis";
import { deleteKeysByPrefix } from "../integrations/delete-keys-by-prefix.js";
import { createRedisClient } from "../integrations/redis-client.js";
import { APPLICATION_KEY_PREFIXES } from "../integrations/redis-keys.js";
import { silentLogger, testRedisUrl } from "./test-config.js";

export async function openTestRedis(): Promise<Redis> {
  const client = createRedisClient(testRedisUrl(), silentLogger);
  if (client.status !== "ready") await once(client, "ready");
  return client;
}

export async function clearApplicationKeys(redis: Redis): Promise<void> {
  for (const prefix of APPLICATION_KEY_PREFIXES) await deleteKeysByPrefix(redis, prefix);
}
```

`apps/event-api/src/integrations/redis-event-view-cache.int.test.ts`:

```ts
import { EventIdSchema } from "@event-desk/contracts";
import { buildSeedEventView } from "@event-desk/contracts/testing";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearApplicationKeys, openTestRedis } from "../testing/redis.js";
import { silentLogger } from "../testing/test-config.js";
import { RedisEventViewCache } from "./redis-event-view-cache.js";
import { eventViewKey, eventViewVersionKey } from "./redis-keys.js";

const E101 = EventIdSchema.parse("E101");
const view = buildSeedEventView();
let redis: Redis;
let cache: RedisEventViewCache;

beforeAll(async () => {
  redis = await openTestRedis();
  cache = new RedisEventViewCache(redis, silentLogger);
});
afterAll(() => {
  redis.disconnect();
});
beforeEach(async () => {
  await clearApplicationKeys(redis);
});

describe("RedisEventViewCache", () => {
  it("misses at version 0 on an empty cache", async () => {
    expect(await cache.lookup(E101)).toEqual({ version: 0, view: null });
  });

  it("stores and returns the view at the observed version, with a TTL", async () => {
    await cache.store(E101, 0, view, 30_000);
    expect(await cache.lookup(E101)).toEqual({ version: 0, view });
    const ttl = await redis.pttl(eventViewKey(E101, 0));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30_000);
  });

  it("invalidates by bumping the version and deleting the old entry", async () => {
    await cache.store(E101, 0, view, 30_000);
    expect(await cache.invalidate(E101)).toBe(1);
    expect(await redis.get(eventViewVersionKey(E101))).toBe("1");
    expect(await redis.exists(eventViewKey(E101, 0))).toBe(0);
    expect(await cache.lookup(E101)).toEqual({ version: 1, view: null });
  });

  it("closes the read/flush race: a late store lands on a retired version (T3 §7)", async () => {
    const before = await cache.lookup(E101);
    await cache.invalidate(E101);
    await cache.store(E101, before.version, view, 30_000);
    expect((await cache.lookup(E101)).view).toBeNull();
  });

  it("treats an unreadable cached entry as a miss", async () => {
    await redis.set(eventViewKey(E101, 0), "{not json", "PX", 30_000);
    expect(await cache.lookup(E101)).toEqual({ version: 0, view: null });
    await redis.set(eventViewKey(E101, 0), JSON.stringify({ event: "wrong shape" }), "PX", 30_000);
    expect(await cache.lookup(E101)).toEqual({ version: 0, view: null });
  });
});
```

`apps/event-api/src/integrations/delete-keys-by-prefix.int.test.ts`:

```ts
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestRedis } from "../testing/redis.js";
import { deleteKeysByPrefix } from "./delete-keys-by-prefix.js";

let redis: Redis;

beforeAll(async () => {
  redis = await openTestRedis();
});
afterAll(async () => {
  await redis.del("other:keep");
  redis.disconnect();
});

describe("deleteKeysByPrefix", () => {
  it("deletes only keys under the prefix", async () => {
    await redis.set("event-desk:a", "1");
    await redis.set("event-desk:b:c", "1");
    await redis.set("bull:briefing-batch:1", "1");
    await redis.set("other:keep", "1");
    expect(await deleteKeysByPrefix(redis, "event-desk:")).toBe(2);
    expect(await redis.exists("other:keep", "bull:briefing-batch:1")).toBe(2);
    await deleteKeysByPrefix(redis, "bull:briefing-batch:");
  });

  it.each(["", "event-desk", "event-desk:*", "*:"])("refuses the unsafe prefix %j", async (prefix) => {
    await expect(deleteKeysByPrefix(redis, prefix)).rejects.toThrow(/prefix/);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm test && pnpm test:integration`
Expected: FAIL. `Failed to resolve import "./cache-ttl.js"`, `"./event-change-publisher.js"`, `"./in-process-change-notifier.js"`, `"../integrations/delete-keys-by-prefix.js"` and `"./redis-event-view-cache.js"`.

- [ ] **Step 4: Implement**

`apps/event-api/src/integrations/redis-keys.ts`:

```ts
import type { EventId } from "@event-desk/contracts";

/** Every Redis key this application owns lives under one of these prefixes (reset deletes only these). */
export const EVENT_DESK_KEY_PREFIX = "event-desk:";
export const BRIEFING_BATCH_KEY_PREFIX = "bull:briefing-batch:";
export const APPLICATION_KEY_PREFIXES = [EVENT_DESK_KEY_PREFIX, BRIEFING_BATCH_KEY_PREFIX] as const;

export const eventViewVersionKey = (eventId: EventId): string => `event-desk:cache:event:${eventId}:ver`;
export const eventViewKey = (eventId: EventId, version: number): string =>
  `event-desk:cache:event:${eventId}:v${version}`;
```

`apps/event-api/src/integrations/redis-client.ts`:

```ts
import { Redis } from "ioredis";
import type { Logger } from "../shared/logger.js";

/**
 * Cache client that fails fast: with the offline queue disabled, a command issued while Redis
 * is down errors immediately instead of waiting, so reads fall back to MySQL without stalling.
 */
export function createRedisClient(url: string, logger: Logger): Redis {
  const client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    commandTimeout: 1_000,
    retryStrategy: (attempt: number) => Math.min(attempt * 250, 2_000),
  });
  let reportedDown = false;
  client.on("ready", () => {
    if (reportedDown) logger.info("redis reconnected");
    reportedDown = false;
  });
  client.on("error", (error: Error) => {
    if (reportedDown) return;
    reportedDown = true;
    logger.warn({ err: error }, "redis unavailable; serving event reads from MySQL");
  });
  return client;
}
```

`apps/event-api/src/integrations/delete-keys-by-prefix.ts`:

```ts
import type { Redis } from "ioredis";

const SAFE_PREFIX = /^[A-Za-z0-9_-]+(:[A-Za-z0-9_-]+)*:$/;

/** SCAN + DEL under one literal prefix (never FLUSHALL/FLUSHDB). Returns the number of keys deleted. */
export async function deleteKeysByPrefix(redis: Redis, prefix: string): Promise<number> {
  if (!SAFE_PREFIX.test(prefix)) throw new Error(`Refusing to delete keys for the unsafe prefix "${prefix}".`);
  let cursor = "0";
  let deleted = 0;
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
    cursor = next;
    if (keys.length > 0) deleted += await redis.del(...keys);
  } while (cursor !== "0");
  return deleted;
}
```

`apps/event-api/src/integrations/redis-event-view-cache.ts`:

```ts
import { type EventId, type EventView, EventViewSchema } from "@event-desk/contracts";
import type { Redis } from "ioredis";
import type { CachedEventView, EventViewCache } from "../ports/event-view-cache.js";
import type { Logger } from "../shared/logger.js";
import { eventViewKey, eventViewVersionKey } from "./redis-keys.js";

export class RedisEventViewCache implements EventViewCache {
  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  async lookup(eventId: EventId): Promise<CachedEventView> {
    const rawVersion = await this.redis.get(eventViewVersionKey(eventId));
    const version = rawVersion === null ? 0 : Number.parseInt(rawVersion, 10);
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new Error(`Cache version key for ${eventId} is not a counter.`);
    }
    const json = await this.redis.get(eventViewKey(eventId, version));
    return { version, view: json === null ? null : this.parse(eventId, json) };
  }

  async store(eventId: EventId, version: number, view: EventView, ttlMs: number): Promise<void> {
    await this.redis.set(eventViewKey(eventId, version), JSON.stringify(view), "PX", ttlMs);
  }

  async invalidate(eventId: EventId): Promise<number> {
    const next = await this.redis.incr(eventViewVersionKey(eventId));
    await this.redis.del(eventViewKey(eventId, next - 1));
    return next;
  }

  private parse(eventId: EventId, json: string): EventView | null {
    try {
      const result = EventViewSchema.safeParse(JSON.parse(json));
      if (result.success) return result.data;
    } catch {
      // fall through: unreadable JSON
    }
    this.logger.warn({ eventId }, "ignoring unreadable cached event view");
    return null;
  }
}
```

`apps/event-api/src/integrations/system-clock.ts`:

```ts
import type { Clock } from "../ports/clock.js";

export const systemClock: Clock = { now: () => new Date() };
```

`apps/event-api/src/modules/changes/cache-bypass.ts`:

```ts
/**
 * After a failed cache flush, reads skip the cache until a later flush succeeds (T3 §7).
 * In-process state: correct because exactly one event-api process runs (T3 §3).
 */
export class CacheBypass {
  #active = false;

  get active(): boolean {
    return this.#active;
  }

  activate(): void {
    this.#active = true;
  }

  clear(): void {
    this.#active = false;
  }
}
```

`apps/event-api/src/modules/changes/in-process-change-notifier.ts`:

```ts
import type { EventId } from "@event-desk/contracts";
import type { ChangeListener, ChangeNotifier } from "../../ports/change-notifier.js";
import type { Logger } from "../../shared/logger.js";

export class InProcessChangeNotifier implements ChangeNotifier {
  readonly #listeners = new Set<ChangeListener>();

  constructor(private readonly logger: Logger) {}

  notify(eventId: EventId): void {
    for (const listener of this.#listeners) {
      try {
        listener(eventId);
      } catch (error) {
        this.logger.warn({ err: error, eventId }, "change listener failed");
      }
    }
  }

  subscribe(listener: ChangeListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
```

`apps/event-api/src/modules/changes/event-change-publisher.ts`:

```ts
import type { EventId } from "@event-desk/contracts";
import type { ChangeNotifier } from "../../ports/change-notifier.js";
import type { EventViewCache } from "../../ports/event-view-cache.js";
import type { Logger } from "../../shared/logger.js";
import type { CacheBypass } from "./cache-bypass.js";

/** Runs after every commit (and, from Plan 5, every queue-state change): flush, then notify. */
export class EventChangePublisher {
  constructor(
    private readonly cache: EventViewCache,
    private readonly bypass: CacheBypass,
    private readonly notifier: ChangeNotifier,
    private readonly logger: Logger,
  ) {}

  /** Never throws: MySQL already holds the truth; a failed flush only switches reads to MySQL. */
  async publish(eventId: EventId): Promise<void> {
    try {
      await this.cache.invalidate(eventId);
      this.bypass.clear();
    } catch (error) {
      this.bypass.activate();
      this.logger.warn({ err: error, eventId }, "event view cache flush failed; reading from MySQL until a flush succeeds");
    }
    this.notifier.notify(eventId);
  }
}
```

`apps/event-api/src/modules/event/domain/cache-ttl.ts`:

```ts
import type { EventView } from "@event-desk/contracts";

/** Default TTL, capped at the next time-driven state change (batch cutoff, retry, cooldown). */
export function cacheTtlMs(view: EventView, now: Date, defaultTtlMs: number): number {
  const deadlines = [view.generation.batch?.closesAt, view.generation.batch?.nextAttemptAt, view.generation.cooldownUntil];
  let ttl = defaultTtlMs;
  for (const deadline of deadlines) {
    if (typeof deadline !== "string") continue;
    ttl = Math.min(ttl, Math.max(0, Date.parse(deadline) - now.getTime()));
  }
  return ttl;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test && pnpm test:integration`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/event-api/src
git commit -m "feat(event-api): versioned Redis event-view cache with flush, bypass and change notifier" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Event read service, composition root, startup and shutdown

**Files:**
- Create: `apps/event-api/src/ports/generation-activity.ts`
- Create: `apps/event-api/src/modules/event/no-generation-activity.ts`, `event-view-service.ts`, `event-controller.ts`
- Create: `apps/event-api/src/persistence/mysql-health-probe.ts`, `apps/event-api/src/integrations/redis-health-probe.ts`
- Create: `apps/event-api/src/compose.ts`, `apps/event-api/src/main.ts`
- Modify: root `package.json` (`dev` script)
- Test: `apps/event-api/src/modules/event/event-view-service.test.ts`, `apps/event-api/src/modules/event/event-api.int.test.ts`

**Interfaces:**
- Consumes:
  - From Tasks 3–8: `createApp`, `healthRoutes`, `parseEventId`, `TypeOrmUnitOfWork`, `bootstrapStore`, `createDataSource`, `loadBriefingViews`, `RedisEventViewCache`, `createRedisClient`, `CacheBypass`, `InProcessChangeNotifier`, `EventChangePublisher`, `cacheTtlMs`, `systemClock`.
  - Config: `loadConfig` and `loadDotEnv`.
  - Test helpers: `integrationConfig`, `silentLogger`, `openTestDataSource`, `truncateAllTables`, `openTestRedis`, `clearApplicationKeys`, the SQL fixtures and `errorCodeOf`.
- Produces:
  - Port: `GenerationActivity` (`current(eventId): Promise<GenerationActivitySnapshot>`) and `GenerationActivitySnapshot` (`Pick<GenerationStatusView, "manual" | "batch" | "cooldownUntil">`).
  - `noGenerationActivity`.
  - `EventViewService({ uow, cache, bypass, activity, clock, defaultTtlMs, logger })` with `.get(eventId): Promise<EventView>`.
  - `eventRoutes(service): Router` serving `GET /api/events/:eventId` with `Cache-Control: no-store`.
  - Health probes: `MysqlHealthProbe(dataSource)` and `RedisHealthProbe(redis)`.
  - `composeEventApi(config, { logger, clock? }): Promise<EventApi>`, where `EventApi` is `{ app: Express; changes: EventChangePublisher; close(): Promise<void> }`. Task 10 adds `attendanceRoutes` to it.

- [ ] **Step 1: Write the failing unit test**

`apps/event-api/src/ports/generation-activity.ts`:

```ts
import type { EventId, GenerationStatusView } from "@event-desk/contracts";

/** Live generation state that is not in MySQL: manual run in flight, batch job, provider cooldown. */
export type GenerationActivitySnapshot = Pick<GenerationStatusView, "manual" | "batch" | "cooldownUntil">;

export interface GenerationActivity {
  current(eventId: EventId): Promise<GenerationActivitySnapshot>;
}
```

`apps/event-api/src/modules/event/event-view-service.test.ts`:

```ts
import { EventIdSchema, type EventView, SUPPLIED_EVENT, SUPPLIED_FEEDBACK, SUPPLIED_MEMBERS } from "@event-desk/contracts";
import { buildSeedEventView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import type { CachedEventView, EventViewCache } from "../../ports/event-view-cache.js";
import type { ReadScope, TransactionScope, UnitOfWork } from "../../ports/unit-of-work.js";
import { createLogger } from "../../shared/logger.js";
import { CacheBypass } from "../changes/cache-bypass.js";
import { EventViewService } from "./event-view-service.js";
import { noGenerationActivity } from "./no-generation-activity.js";

const E101 = SUPPLIED_EVENT.id;
const NOW = new Date("2026-10-03T09:00:00.000Z");

class FakeUnitOfWork implements UnitOfWork {
  snapshots = 0;
  readonly scope: ReadScope = {
    events: {
      findAggregate: (eventId) =>
        Promise.resolve(
          eventId === E101
            ? {
                event: SUPPLIED_EVENT,
                attendanceRevision: 0,
                briefingRevision: 0,
                members: [...SUPPLIED_MEMBERS],
                feedback: SUPPLIED_FEEDBACK.map((n) => ({ ...n, receivedAt: FIXTURE_TIME })),
              }
            : null,
        ),
    },
    briefings: { loadSlots: () => Promise.resolve({ saved: null, selected: null, incoming: null }) },
    outcomes: { latest: () => Promise.resolve(null) },
  };
  run<T>(_work: (tx: TransactionScope) => Promise<T>): Promise<T> {
    return Promise.reject(new Error("the event read never writes"));
  }
  readSnapshot<T>(work: (scope: ReadScope) => Promise<T>): Promise<T> {
    this.snapshots += 1;
    return work(this.scope);
  }
}

class FakeCache implements EventViewCache {
  cached: EventView | null = null;
  lookupError: Error | null = null;
  storeError: Error | null = null;
  stored: { version: number; ttlMs: number }[] = [];
  lookup(): Promise<CachedEventView> {
    return this.lookupError ? Promise.reject(this.lookupError) : Promise.resolve({ version: 7, view: this.cached });
  }
  store(_eventId: unknown, version: number, _view: EventView, ttlMs: number): Promise<void> {
    if (this.storeError) return Promise.reject(this.storeError);
    this.stored.push({ version, ttlMs });
    return Promise.resolve();
  }
  invalidate(): Promise<number> {
    return Promise.resolve(8);
  }
}

function setup(defaultTtlMs = 30_000) {
  const uow = new FakeUnitOfWork();
  const cache = new FakeCache();
  const bypass = new CacheBypass();
  const service = new EventViewService({
    uow,
    cache,
    bypass,
    activity: noGenerationActivity,
    clock: { now: () => NOW },
    defaultTtlMs,
    logger: createLogger("silent"),
  });
  return { uow, cache, bypass, service };
}

describe("EventViewService", () => {
  it("builds the view on a miss and caches it at the version read before the database read", async () => {
    const { uow, cache, service } = setup();
    const view = await service.get(E101);
    expect(view.counts).toEqual({ registered: 4, attended: 1, absent: 2, notRecorded: 1 });
    expect(view.generation).toEqual({ manual: null, batch: null, lastOutcome: null, cooldownUntil: null });
    expect(view.savedBriefing).toBeNull();
    expect(uow.snapshots).toBe(1);
    expect(cache.stored).toEqual([{ version: 7, ttlMs: 30_000 }]);
  });

  it("serves a cache hit without touching MySQL", async () => {
    const { uow, cache, service } = setup();
    cache.cached = buildSeedEventView({ attendanceRevision: 3 });
    expect((await service.get(E101)).attendanceRevision).toBe(3);
    expect(uow.snapshots).toBe(0);
  });

  it("skips the cache entirely while the bypass is active", async () => {
    const { uow, cache, bypass, service } = setup();
    bypass.activate();
    cache.cached = buildSeedEventView({ attendanceRevision: 3 });
    expect((await service.get(E101)).attendanceRevision).toBe(0);
    expect(uow.snapshots).toBe(1);
    expect(cache.stored).toEqual([]);
  });

  it("reads MySQL when the cache read fails, and does not store", async () => {
    const { uow, cache, service } = setup();
    cache.lookupError = new Error("ECONNREFUSED");
    await service.get(E101);
    expect(uow.snapshots).toBe(1);
    expect(cache.stored).toEqual([]);
  });

  it("still answers when storing fails", async () => {
    const { cache, service } = setup();
    cache.storeError = new Error("ECONNRESET");
    await expect(service.get(E101)).resolves.toMatchObject({ event: SUPPLIED_EVENT });
  });

  it("does not cache when the TTL is 0", async () => {
    const { cache, service } = setup(0);
    await service.get(E101);
    expect(cache.stored).toEqual([]);
  });

  it("answers an unknown event with EVENT_NOT_FOUND and caches nothing", async () => {
    const { cache, service } = setup();
    await expect(service.get(EventIdSchema.parse("E999"))).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
    expect(cache.stored).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test`
Expected: FAIL. `Failed to resolve import "./event-view-service.js"`.

- [ ] **Step 3: Implement the service and controller**

`apps/event-api/src/modules/event/no-generation-activity.ts`:

```ts
import type { GenerationActivity } from "../../ports/generation-activity.js";

/** Until Plans 3 and 5 add manual generation and the batch queue, nothing is ever running. */
export const noGenerationActivity: GenerationActivity = {
  current: () => Promise.resolve({ manual: null, batch: null, cooldownUntil: null }),
};
```

`apps/event-api/src/modules/event/event-view-service.ts`:

```ts
import { deriveAttendanceCounts, type EventId, type EventView } from "@event-desk/contracts";
import type { Clock } from "../../ports/clock.js";
import type { CachedEventView, EventViewCache } from "../../ports/event-view-cache.js";
import type { GenerationActivity } from "../../ports/generation-activity.js";
import type { UnitOfWork } from "../../ports/unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import type { Logger } from "../../shared/logger.js";
import { loadBriefingViews } from "../briefing/briefing-views.js";
import type { CacheBypass } from "../changes/cache-bypass.js";
import { cacheTtlMs } from "./domain/cache-ttl.js";

export interface EventViewServiceDeps {
  uow: UnitOfWork;
  cache: EventViewCache;
  bypass: CacheBypass;
  activity: GenerationActivity;
  clock: Clock;
  defaultTtlMs: number;
  logger: Logger;
}

/** GET /api/events/:id — cache first, MySQL snapshot on a miss; freshness computed while building (T3 §7). */
export class EventViewService {
  constructor(private readonly deps: EventViewServiceDeps) {}

  async get(eventId: EventId): Promise<EventView> {
    const cached = await this.lookup(eventId);
    if (cached?.view) return cached.view;
    const view = await this.build(eventId);
    if (cached !== null) await this.store(eventId, cached.version, view);
    return view;
  }

  private async lookup(eventId: EventId): Promise<CachedEventView | null> {
    if (this.deps.bypass.active) return null;
    try {
      return await this.deps.cache.lookup(eventId);
    } catch (error) {
      this.deps.logger.warn({ err: error, eventId }, "event view cache read failed; reading from MySQL");
      return null;
    }
  }

  private async store(eventId: EventId, version: number, view: EventView): Promise<void> {
    if (this.deps.bypass.active) return;
    const ttlMs = cacheTtlMs(view, this.deps.clock.now(), this.deps.defaultTtlMs);
    if (ttlMs <= 0) return;
    try {
      await this.deps.cache.store(eventId, version, view, ttlMs);
    } catch (error) {
      this.deps.logger.warn({ err: error, eventId }, "event view cache write failed");
    }
  }

  private async build(eventId: EventId): Promise<EventView> {
    const snapshot = await this.deps.uow.readSnapshot(async (scope) => {
      const aggregate = await scope.events.findAggregate(eventId);
      if (aggregate === null) throw new AppError("EVENT_NOT_FOUND", `Event ${eventId} was not found.`);
      const briefings = await loadBriefingViews(scope, eventId, aggregate.members, aggregate.feedback);
      const lastOutcome = await scope.outcomes.latest(eventId);
      return { aggregate, briefings, lastOutcome };
    });
    const activity = await this.deps.activity.current(eventId);
    const { aggregate, briefings, lastOutcome } = snapshot;
    return {
      event: aggregate.event,
      members: aggregate.members,
      feedback: aggregate.feedback,
      counts: deriveAttendanceCounts(aggregate.members),
      attendanceRevision: aggregate.attendanceRevision,
      briefingRevision: aggregate.briefingRevision,
      ...briefings,
      generation: { ...activity, lastOutcome },
    };
  }
}
```

`apps/event-api/src/modules/event/event-controller.ts`:

```ts
import express, { type Router } from "express";
import { parseEventId } from "../../http/validate.js";
import type { EventViewService } from "./event-view-service.js";

export function eventRoutes(service: EventViewService): Router {
  const router = express.Router();
  router.get("/events/:eventId", async (req, res) => {
    const view = await service.get(parseEventId(req.params.eventId));
    res.set("Cache-Control", "no-store").json(view);
  });
  return router;
}
```

Run: `pnpm test`
Expected: PASS for `event-view-service.test.ts`.

- [ ] **Step 4: Write the composition root, probes and entry point**

`apps/event-api/src/persistence/mysql-health-probe.ts`:

```ts
import type { DataSource } from "typeorm";
import type { HealthProbe } from "../ports/health-probe.js";

export class MysqlHealthProbe implements HealthProbe {
  constructor(private readonly dataSource: DataSource) {}

  async isUp(): Promise<boolean> {
    try {
      await this.dataSource.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}
```

`apps/event-api/src/integrations/redis-health-probe.ts`:

```ts
import type { Redis } from "ioredis";
import type { HealthProbe } from "../ports/health-probe.js";

export class RedisHealthProbe implements HealthProbe {
  constructor(private readonly redis: Redis) {}

  async isUp(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}
```

`apps/event-api/src/compose.ts`:

```ts
import type { Express } from "express";
import { createApp } from "./app.js";
import type { AppConfig } from "./config/env.js";
import { createRedisClient } from "./integrations/redis-client.js";
import { RedisEventViewCache } from "./integrations/redis-event-view-cache.js";
import { RedisHealthProbe } from "./integrations/redis-health-probe.js";
import { systemClock } from "./integrations/system-clock.js";
import { CacheBypass } from "./modules/changes/cache-bypass.js";
import { EventChangePublisher } from "./modules/changes/event-change-publisher.js";
import { InProcessChangeNotifier } from "./modules/changes/in-process-change-notifier.js";
import { eventRoutes } from "./modules/event/event-controller.js";
import { EventViewService } from "./modules/event/event-view-service.js";
import { noGenerationActivity } from "./modules/event/no-generation-activity.js";
import { healthRoutes } from "./modules/health/health-controller.js";
import { createDataSource } from "./persistence/data-source.js";
import { MysqlHealthProbe } from "./persistence/mysql-health-probe.js";
import { bootstrapStore } from "./persistence/store-bootstrap.js";
import type { Clock } from "./ports/clock.js";
import { TypeOrmUnitOfWork } from "./repositories/typeorm-unit-of-work.js";
import type { Logger } from "./shared/logger.js";

export interface EventApi {
  readonly app: Express;
  readonly changes: EventChangePublisher;
  close(): Promise<void>;
}

export interface ComposeOptions {
  logger: Logger;
  clock?: Clock;
}

/**
 * The composition root: the only place that knows concrete adapters. Startup fails clearly
 * (and never seeds) when MySQL is unreachable; Redis is optional and reconnects on its own.
 */
export async function composeEventApi(config: AppConfig, { logger, clock = systemClock }: ComposeOptions): Promise<EventApi> {
  const dataSource = createDataSource(config.mysqlUrl);
  await dataSource.initialize();
  try {
    await bootstrapStore(dataSource, logger, clock.now());
  } catch (error) {
    await dataSource.destroy();
    throw error;
  }

  const redis = createRedisClient(config.redisUrl, logger);
  const uow = new TypeOrmUnitOfWork(dataSource, logger);
  const cache = new RedisEventViewCache(redis, logger);
  const bypass = new CacheBypass();
  const notifier = new InProcessChangeNotifier(logger);
  const changes = new EventChangePublisher(cache, bypass, notifier, logger);
  const eventViews = new EventViewService({
    uow,
    cache,
    bypass,
    activity: noGenerationActivity,
    clock,
    defaultTtlMs: config.eventViewCacheTtlMs,
    logger,
  });

  const app = createApp({
    logger,
    policy: { allowedOrigins: config.allowedOrigins, allowedHosts: config.allowedHosts },
    routes: [
      healthRoutes({ mysql: new MysqlHealthProbe(dataSource), redis: new RedisHealthProbe(redis) }),
      eventRoutes(eventViews),
    ],
  });

  return {
    app,
    changes,
    async close() {
      redis.disconnect();
      await dataSource.destroy();
    },
  };
}
```

`apps/event-api/src/main.ts`:

```ts
import { composeEventApi } from "./compose.js";
import { type AppConfig, ConfigError, loadConfig, loadDotEnv } from "./config/env.js";
import { createLogger } from "./shared/logger.js";

const SHUTDOWN_GRACE_MS = 10_000;

loadDotEnv(new URL("../../../.env", import.meta.url));

function readConfig(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      createLogger("info").fatal({ problems: error.problems }, error.message);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const logger = createLogger(config.logLevel);
const api = await composeEventApi(config, { logger }).catch((error: unknown) => {
  logger.fatal({ err: error }, "event API failed to start (is MySQL running? try: pnpm infra:up)");
  process.exit(1);
});

const server = api.app.listen(config.port, config.host, (error?: Error) => {
  if (error) {
    logger.fatal({ err: error }, "event API could not listen");
    process.exit(1);
  }
  logger.info({ host: config.host, port: config.port }, "event API listening");
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, "shutting down");
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  server.close(() => {
    void api.close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, "shutdown failed");
        process.exit(1);
      },
    );
  });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
```

Root `package.json` `scripts`: add `"dev": "pnpm --filter @event-desk/event-api dev",`.

- [ ] **Step 5: Write the integration tests**

`apps/event-api/src/modules/event/event-api.int.test.ts`:

```ts
import { EventViewSchema, SUPPLIED_EVENT, SUPPLIED_FEEDBACK, SUPPLIED_MEMBERS } from "@event-desk/contracts";
import type { Redis } from "ioredis";
import request from "supertest";
import type { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { composeEventApi, type EventApi } from "../../compose.js";
import { eventViewKey } from "../../integrations/redis-keys.js";
import { openTestDataSource, truncateAllTables } from "../../testing/database.js";
import { errorCodeOf } from "../../testing/http.js";
import { clearApplicationKeys, openTestRedis } from "../../testing/redis.js";
import { GENERATION_FIXTURE_ID, insertGenerationFixture, putPreviewSlot } from "../../testing/sql-fixtures.js";
import { integrationConfig, silentLogger } from "../../testing/test-config.js";

const E101 = SUPPLIED_EVENT.id;
let dataSource: DataSource;
let redis: Redis;
let api: EventApi;

const getEvent = (app = api.app) => request(app).get(`/api/events/${E101}`);

beforeAll(async () => {
  dataSource = await openTestDataSource();
  redis = await openTestRedis();
});
afterAll(async () => {
  redis.disconnect();
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await clearApplicationKeys(redis);
  api = await composeEventApi(integrationConfig(), { logger: silentLogger });
});
afterEach(async () => {
  await api.close();
});

describe("GET /api/events/:eventId", () => {
  it("F1-01 / F3-01: returns the seeded event, roster, exact notes and derived counts", async () => {
    const res = await getEvent();
    expect(res.status).toBe(200);
    expect(res.get("Cache-Control")).toBe("no-store");
    const view = EventViewSchema.parse(res.body);
    expect(view.event).toEqual(SUPPLIED_EVENT);
    expect(view.members).toEqual(SUPPLIED_MEMBERS);
    expect(view.feedback.map((n) => [n.id, n.text])).toEqual(SUPPLIED_FEEDBACK.map((n) => [n.id, n.text]));
    expect(view.counts).toEqual({ registered: 4, attended: 1, absent: 2, notRecorded: 1 });
    expect([view.savedBriefing, view.selectedPreview, view.incomingPreview]).toEqual([null, null, null]);
    expect(view.generation).toEqual({ manual: null, batch: null, lastOutcome: null, cooldownUntil: null });
  });

  it.each(["E999", "e101", "E101%20", "%00"])("F1-08: answers %s with EVENT_NOT_FOUND", async (id) => {
    const res = await request(api.app).get(`/api/events/${id}`);
    expect(res.status).toBe(404);
    expect(errorCodeOf(res)).toBe("EVENT_NOT_FOUND");
  });

  it("serves later reads from the cache until a change is published (T3 §7)", async () => {
    await getEvent();
    expect(await redis.exists(eventViewKey(E101, 0))).toBe(1);
    await dataSource.query("UPDATE members SET attendance = 'attended' WHERE id = 'M03'");
    expect(EventViewSchema.parse((await getEvent()).body).counts.attended).toBe(1);
    await api.changes.publish(E101);
    expect(EventViewSchema.parse((await getEvent()).body).counts.attended).toBe(2);
  });

  it("includes stored briefings with freshness computed from saved records", async () => {
    await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", GENERATION_FIXTURE_ID);
    await api.changes.publish(E101);
    const current = EventViewSchema.parse((await getEvent()).body);
    expect(current.incomingPreview?.freshness.current).toBe(true);
    await dataSource.query("UPDATE members SET attendance = 'attended' WHERE id = 'M03'");
    await api.changes.publish(E101);
    const stale = EventViewSchema.parse((await getEvent()).body);
    expect(stale.incomingPreview?.freshness).toEqual({
      current: false,
      attendanceChanges: [{ memberId: "M03", from: "not_recorded", to: "attended" }],
      newFeedbackIds: [],
    });
  });
});

describe("degraded stores", () => {
  it("serves from MySQL quickly when Redis is unreachable, and reports it", async () => {
    const offline = await composeEventApi(integrationConfig({ redisUrl: "redis://127.0.0.1:6390/1" }), { logger: silentLogger });
    try {
      const started = Date.now();
      const res = await getEvent(offline.app);
      expect(res.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(2_000);
      const health = await request(offline.app).get("/api/health");
      expect(health.body).toEqual({ mysql: "up", redis: "down" });
    } finally {
      await offline.close();
    }
  });

  it("answers 503 STORE_UNAVAILABLE without internals once MySQL is gone", async () => {
    const doomed = await composeEventApi(integrationConfig(), { logger: silentLogger });
    await doomed.close();
    const res = await getEvent(doomed.app);
    expect(res.status).toBe(503);
    expect(errorCodeOf(res)).toBe("STORE_UNAVAILABLE");
    expect(JSON.stringify(res.body)).not.toMatch(/stack|SELECT|mysql:\/\//i);
  });

  it("fails startup clearly, without seeding, when MySQL is unreachable", async () => {
    await expect(
      composeEventApi(integrationConfig({ mysqlUrl: "mysql://event_desk:x@127.0.0.1:3399/event_desk_test" }), {
        logger: silentLogger,
      }),
    ).rejects.toThrow();
  });

  it("F1-04: a second start against the same store neither duplicates nor resets data", async () => {
    await dataSource.query("UPDATE members SET attendance = 'attended' WHERE id = 'M03'");
    const second = await composeEventApi(integrationConfig(), { logger: silentLogger });
    try {
      const [counts] = await dataSource.query<{ events: number; members: number; notes: number }[]>(
        "SELECT (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM members) AS members, (SELECT COUNT(*) FROM feedback_notes) AS notes",
      );
      expect([Number(counts?.events), Number(counts?.members), Number(counts?.notes)]).toEqual([1, 4, 8]);
      await second.changes.publish(E101);
      expect(EventViewSchema.parse((await getEvent(second.app)).body).counts.attended).toBe(2);
    } finally {
      await second.close();
    }
  });

  it("reports health of both stores", async () => {
    expect((await request(api.app).get("/api/health")).body).toEqual({ mysql: "up", redis: "up" });
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test && pnpm test:integration`
Expected: PASS.

- [ ] **Step 7: Run the real process once (dev and built)**

Run, with MySQL and Redis up and `.env` present (`cp .env.example .env` if missing):

```bash
pnpm --filter @event-desk/event-api exec tsx --conditions=@event-desk/source src/main.ts > /tmp/event-api-dev.log 2>&1 &
sleep 3
curl -s http://127.0.0.1:4000/api/health
curl -s http://127.0.0.1:4000/api/events/E101 | head -c 300
kill -TERM %1; sleep 1; tail -3 /tmp/event-api-dev.log
```

Expected:
- `{"mysql":"up","redis":"up"}`;
- the event JSON beginning `{"event":{"id":"E101","name":"Saturday Walk"`;
- the log ending with a `shutting down` line, and the process exiting.

Then check the production build path, where workspace packages resolve to `dist/` through the default condition:

```bash
pnpm build
node apps/event-api/dist/main.js > /tmp/event-api-prod.log 2>&1 &
sleep 3
curl -s http://127.0.0.1:4000/api/health
kill -TERM %1
```

Expected: `{"mysql":"up","redis":"up"}`. Record both outputs in your report. If `tsx --conditions=…` is not accepted, use `NODE_OPTIONS=--conditions=@event-desk/source tsx …` in the `dev` script instead, and report the change.

- [ ] **Step 8: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0, including `pnpm arch`. `compose.ts` is imported only by `main.ts` and tests.

```bash
git add apps/event-api/src package.json
git commit -m "feat(event-api): cached event read, composition root, startup and graceful shutdown" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Save attendance (F2, TX3)

**Files:**
- Create: `apps/event-api/src/modules/attendance/domain/diff-attendance.ts`, `apps/event-api/src/modules/attendance/attendance-service.ts`, `apps/event-api/src/modules/attendance/attendance-controller.ts`
- Modify: `apps/event-api/src/compose.ts`
- Test: `apps/event-api/src/modules/attendance/domain/diff-attendance.test.ts`, `apps/event-api/src/modules/attendance/attendance.int.test.ts`

**Interfaces:**
- Consumes: `UnitOfWork`, `TransactionScope`, `lockForUpdate`, `applyAttendanceChanges` (Task 5); `loadBriefingViews`, `freshnessSummary` (Task 7); `EventChangePublisher` (Task 8); `composeEventApi` (Task 9); `validateBody`, `parseEventId` (Task 3). From contracts: `SaveAttendanceRequestSchema`, `SaveAttendanceResponse(Schema)`, `AttendanceChange`, `deriveAttendanceCounts`.
- Produces:
  - `diffAttendance(current, requested): AttendanceDiff` and `applyAttendanceChanges(members, changes): Member[]`.
  - `AttendanceService(uow, changes)` with `.save(command): Promise<SaveAttendanceResponse>`.
  - `attendanceRoutes(service): Router` serving `PUT /api/events/:eventId/attendance`.

- [ ] **Step 1: Write the failing unit test**

`apps/event-api/src/modules/attendance/domain/diff-attendance.test.ts`:

```ts
import { MemberIdSchema, SUPPLIED_MEMBERS } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { applyAttendanceChanges, diffAttendance, type RequestedAttendance } from "./diff-attendance.js";

const id = (value: string) => MemberIdSchema.parse(value);
const asRequested = (overrides: Record<string, RequestedAttendance["attendance"]> = {}): RequestedAttendance[] =>
  SUPPLIED_MEMBERS.map((m) => ({ id: m.id, attendance: overrides[m.id] ?? m.attendance }));

describe("diffAttendance", () => {
  it("reports no changes for an unchanged roster", () => {
    expect(diffAttendance(SUPPLIED_MEMBERS, asRequested())).toEqual({ kind: "changes", changes: [] });
  });

  it("is order-insensitive", () => {
    expect(diffAttendance(SUPPLIED_MEMBERS, asRequested({ M03: "attended" }).toReversed())).toEqual({
      kind: "changes",
      changes: [{ memberId: "M03", from: "not_recorded", to: "attended" }],
    });
  });

  it("treats a swap as two changes even though counts are equal (F2-07)", () => {
    const diff = diffAttendance(SUPPLIED_MEMBERS, asRequested({ M01: "absent", M02: "attended" }));
    expect(diff).toEqual({
      kind: "changes",
      changes: [
        { memberId: "M01", from: "attended", to: "absent" },
        { memberId: "M02", from: "absent", to: "attended" },
      ],
    });
  });

  it("rejects a roster with missing or unknown members (F2-05)", () => {
    const requested = [...asRequested().slice(1), { id: id("M09"), attendance: "attended" as const }];
    expect(diffAttendance(SUPPLIED_MEMBERS, requested)).toEqual({
      kind: "roster_mismatch",
      missing: ["M01"],
      unknown: ["M09"],
    });
  });
});

describe("applyAttendanceChanges", () => {
  it("returns new member records without mutating the input", () => {
    const changed = applyAttendanceChanges(SUPPLIED_MEMBERS, [{ memberId: id("M03"), from: "not_recorded", to: "attended" }]);
    expect(changed.find((m) => m.id === "M03")?.attendance).toBe("attended");
    expect(SUPPLIED_MEMBERS.find((m) => m.id === "M03")?.attendance).toBe("not_recorded");
  });
});
```

Run: `pnpm test`
Expected: FAIL. `Failed to resolve import "./diff-attendance.js"`.

- [ ] **Step 2: Implement the domain, service and controller**

`apps/event-api/src/modules/attendance/domain/diff-attendance.ts`:

```ts
import type { AttendanceChange, AttendanceStatus, Member, MemberId } from "@event-desk/contracts";

export interface RequestedAttendance {
  readonly id: MemberId;
  readonly attendance: AttendanceStatus;
}

export type AttendanceDiff =
  | { kind: "changes"; changes: AttendanceChange[] }
  | { kind: "roster_mismatch"; missing: MemberId[]; unknown: MemberId[] };

/** The request must list every registered member exactly once; only real status differences count. */
export function diffAttendance(
  current: readonly Pick<Member, "id" | "attendance">[],
  requested: readonly RequestedAttendance[],
): AttendanceDiff {
  const requestedById = new Map(requested.map((entry) => [entry.id, entry.attendance]));
  const rosterIds = new Set(current.map((member) => member.id));
  const missing = current.filter((member) => !requestedById.has(member.id)).map((member) => member.id);
  const unknown = requested.filter((entry) => !rosterIds.has(entry.id)).map((entry) => entry.id);
  if (missing.length > 0 || unknown.length > 0) return { kind: "roster_mismatch", missing, unknown };
  const changes = current.flatMap((member) => {
    const to = requestedById.get(member.id);
    return to === undefined || to === member.attendance ? [] : [{ memberId: member.id, from: member.attendance, to }];
  });
  return { kind: "changes", changes };
}

export function applyAttendanceChanges(members: readonly Member[], changes: readonly AttendanceChange[]): Member[] {
  const next = new Map(changes.map((change) => [change.memberId, change.to]));
  return members.map((member) => ({ ...member, attendance: next.get(member.id) ?? member.attendance }));
}
```

`apps/event-api/src/modules/attendance/attendance-service.ts`:

```ts
import { deriveAttendanceCounts, type EventId, type SaveAttendanceResponse } from "@event-desk/contracts";
import type { UnitOfWork } from "../../ports/unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import { freshnessSummary, loadBriefingViews } from "../briefing/briefing-views.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import { type AttendanceDiff, applyAttendanceChanges, diffAttendance, type RequestedAttendance } from "./domain/diff-attendance.js";

export interface SaveAttendanceCommand {
  eventId: EventId;
  baseAttendanceRevision: number;
  members: readonly RequestedAttendance[];
}

function rosterMismatch(diff: Extract<AttendanceDiff, { kind: "roster_mismatch" }>): AppError {
  const problems = [
    ...(diff.missing.length > 0 ? [`missing ${diff.missing.join(", ")}`] : []),
    ...(diff.unknown.length > 0 ? [`not registered ${diff.unknown.join(", ")}`] : []),
  ];
  return new AppError("VALIDATION_FAILED", `members must list each registered member exactly once (${problems.join("; ")}).`, {
    field: "members",
  });
}

/** TX3: lock the event row, check the revision inside the lock, write only changed members. */
export class AttendanceService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly changes: Pick<EventChangePublisher, "publish">,
  ) {}

  save(command: SaveAttendanceCommand): Promise<SaveAttendanceResponse> {
    return this.uow.run(async (tx) => {
      const aggregate = await tx.events.lockForUpdate(command.eventId);
      const diff = diffAttendance(aggregate.members, command.members);
      if (diff.kind === "roster_mismatch") throw rosterMismatch(diff);
      if (aggregate.attendanceRevision !== command.baseAttendanceRevision) {
        throw new AppError(
          "ATTENDANCE_CONFLICT",
          "Attendance was saved elsewhere since you loaded it. Reload to see the latest records.",
        );
      }

      let members = aggregate.members;
      let attendanceRevision = aggregate.attendanceRevision;
      if (diff.changes.length > 0) {
        await tx.events.applyAttendanceChanges(command.eventId, diff.changes);
        members = applyAttendanceChanges(aggregate.members, diff.changes);
        attendanceRevision += 1;
        tx.afterCommit(() => this.changes.publish(command.eventId));
      }

      const briefings = await loadBriefingViews(tx, command.eventId, members, aggregate.feedback);
      return {
        members,
        counts: deriveAttendanceCounts(members),
        attendanceRevision,
        freshness: freshnessSummary(briefings),
      };
    });
  }
}
```

`apps/event-api/src/modules/attendance/attendance-controller.ts`:

```ts
import { SaveAttendanceRequestSchema } from "@event-desk/contracts";
import express, { type Router } from "express";
import { parseEventId, validateBody } from "../../http/validate.js";
import type { AttendanceService } from "./attendance-service.js";

export function attendanceRoutes(service: AttendanceService): Router {
  const router = express.Router();
  router.put("/events/:eventId/attendance", async (req, res) => {
    const eventId = parseEventId(req.params.eventId);
    const body = validateBody(SaveAttendanceRequestSchema, req.body);
    res.json(await service.save({ eventId, baseAttendanceRevision: body.baseAttendanceRevision, members: body.members }));
  });
  return router;
}
```

In `compose.ts`, import `AttendanceService` and `attendanceRoutes`. After `eventViews`, construct `const attendance = new AttendanceService(uow, changes);`, and add `attendanceRoutes(attendance)` to the `routes` array after `eventRoutes(eventViews)`.

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 3: Write the integration tests**

`apps/event-api/src/modules/attendance/attendance.int.test.ts`:

```ts
import { EventViewSchema, SaveAttendanceResponseSchema, SUPPLIED_EVENT, SUPPLIED_MEMBERS } from "@event-desk/contracts";
import type { Redis } from "ioredis";
import request from "supertest";
import type { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { composeEventApi, type EventApi } from "../../compose.js";
import { eventViewVersionKey } from "../../integrations/redis-keys.js";
import { openTestDataSource, truncateAllTables } from "../../testing/database.js";
import { errorCodeOf } from "../../testing/http.js";
import { clearApplicationKeys, openTestRedis } from "../../testing/redis.js";
import { GENERATION_FIXTURE_ID, insertGenerationFixture, putPreviewSlot } from "../../testing/sql-fixtures.js";
import { integrationConfig, silentLogger } from "../../testing/test-config.js";

const E101 = SUPPLIED_EVENT.id;
type Status = "attended" | "absent" | "not_recorded";
const roster = (overrides: Record<string, Status> = {}) =>
  SUPPLIED_MEMBERS.map((m) => ({ id: m.id, attendance: overrides[m.id] ?? m.attendance }));

let dataSource: DataSource;
let redis: Redis;
let api: EventApi;

const save = (body: object, app = api.app) =>
  request(app).put(`/api/events/${E101}/attendance`).set("Origin", "http://localhost:5173").send(body);
const statuses = async () =>
  (await dataSource.query<{ id: string; attendance: string }[]>("SELECT id, attendance FROM members ORDER BY display_order")).map(
    (r) => `${r.id}:${r.attendance}`,
  );
const revision = async () =>
  Number((await dataSource.query<{ r: number }[]>("SELECT attendance_revision AS r FROM events"))[0]?.r);

beforeAll(async () => {
  dataSource = await openTestDataSource();
  redis = await openTestRedis();
});
afterAll(async () => {
  redis.disconnect();
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await clearApplicationKeys(redis);
  api = await composeEventApi(integrationConfig(), { logger: silentLogger });
});
afterEach(async () => {
  await api.close();
});

describe("PUT /api/events/:eventId/attendance", () => {
  it("F2-02/F2-03: saves the spec example and returns derived counts and the new revision", async () => {
    const res = await save({ baseAttendanceRevision: 0, members: roster({ M03: "attended" }) });
    expect(res.status).toBe(200);
    const body = SaveAttendanceResponseSchema.parse(res.body);
    expect(body.counts).toEqual({ registered: 4, attended: 2, absent: 2, notRecorded: 0 });
    expect(body.attendanceRevision).toBe(1);
    expect(body.freshness).toEqual({ savedBriefing: null, selectedPreview: null, incomingPreview: null });
    expect(await statuses()).toEqual(["M01:attended", "M02:absent", "M03:attended", "M04:absent"]);
  });

  it("F1-02: the save survives a backend restart", async () => {
    await save({ baseAttendanceRevision: 0, members: roster({ M03: "attended" }) });
    await api.close();
    api = await composeEventApi(integrationConfig(), { logger: silentLogger });
    const view = EventViewSchema.parse((await request(api.app).get(`/api/events/${E101}`)).body);
    expect(view.counts).toEqual({ registered: 4, attended: 2, absent: 2, notRecorded: 0 });
    expect(view.attendanceRevision).toBe(1);
  });

  it("F2-04: all Not recorded stays distinct from Absent", async () => {
    const all = { M01: "not_recorded", M02: "not_recorded", M03: "not_recorded", M04: "not_recorded" } as const;
    const body = SaveAttendanceResponseSchema.parse((await save({ baseAttendanceRevision: 0, members: roster(all) })).body);
    expect(body.counts).toEqual({ registered: 4, attended: 0, absent: 0, notRecorded: 4 });
  });

  it("F2-06: an unchanged save keeps the revision and does not flush the cache", async () => {
    await request(api.app).get(`/api/events/${E101}`);
    const res = await save({ baseAttendanceRevision: 0, members: roster().toReversed() });
    expect(res.status).toBe(200);
    expect(SaveAttendanceResponseSchema.parse(res.body).attendanceRevision).toBe(0);
    expect(await redis.get(eventViewVersionKey(E101))).toBeNull();
    expect(await revision()).toBe(0);
  });

  it("refreshes the cached event view after a real change", async () => {
    await request(api.app).get(`/api/events/${E101}`);
    await save({ baseAttendanceRevision: 0, members: roster({ M03: "attended" }) });
    const view = EventViewSchema.parse((await request(api.app).get(`/api/events/${E101}`)).body);
    expect(view.members.find((m) => m.id === "M03")?.attendance).toBe("attended");
  });

  it.each([
    ["an unknown state", { baseAttendanceRevision: 0, members: roster().map((m, i) => (i === 0 ? { ...m, attendance: "late" } : m)) }],
    ["a duplicate member", { baseAttendanceRevision: 0, members: [...roster(), roster()[0]] }],
    ["a missing member", { baseAttendanceRevision: 0, members: roster().slice(1) }],
    ["an unknown member", { baseAttendanceRevision: 0, members: [...roster().slice(1), { id: "M09", attendance: "attended" }] }],
    ["client-supplied counts", { baseAttendanceRevision: 0, members: roster(), counts: { registered: 4 } }],
    ["a negative revision", { baseAttendanceRevision: -1, members: roster() }],
  ])("F2-05: rejects %s with 400 and writes nothing", async (_label, body) => {
    const res = await save(body);
    expect(res.status).toBe(400);
    expect(errorCodeOf(res)).toBe("VALIDATION_FAILED");
    expect(await statuses()).toEqual(["M01:attended", "M02:absent", "M03:not_recorded", "M04:absent"]);
    expect(await revision()).toBe(0);
  });

  it("rejects a stale base revision with ATTENDANCE_CONFLICT", async () => {
    await save({ baseAttendanceRevision: 0, members: roster({ M03: "attended" }) });
    const stale = await save({ baseAttendanceRevision: 0, members: roster({ M04: "attended" }) });
    expect(stale.status).toBe(409);
    expect(errorCodeOf(stale)).toBe("ATTENDANCE_CONFLICT");
    expect(await statuses()).toEqual(["M01:attended", "M02:absent", "M03:attended", "M04:absent"]);
  });

  it("T4-04: two concurrent saves from the same revision: one wins, one conflicts, no partial rows", async () => {
    const [a, b] = await Promise.all([
      save({ baseAttendanceRevision: 0, members: roster({ M03: "attended" }) }),
      save({ baseAttendanceRevision: 0, members: roster({ M04: "attended", M02: "attended" }) }),
    ]);
    expect([a.status, b.status].toSorted()).toEqual([200, 409]);
    const winner = SaveAttendanceResponseSchema.parse((a.status === 200 ? a : b).body);
    expect(await statuses()).toEqual(winner.members.map((m) => `${m.id}:${m.attendance}`));
    expect(await revision()).toBe(1);
  });

  it("F2-07 / T4-07: a swap makes an existing briefing stale; swapping back makes it current", async () => {
    await insertGenerationFixture(dataSource);
    await putPreviewSlot(dataSource, "incoming", GENERATION_FIXTURE_ID);
    const swapped = SaveAttendanceResponseSchema.parse(
      (await save({ baseAttendanceRevision: 0, members: roster({ M01: "absent", M02: "attended" }) })).body,
    );
    expect(swapped.counts).toEqual({ registered: 4, attended: 1, absent: 2, notRecorded: 1 });
    expect(swapped.freshness.incomingPreview?.current).toBe(false);
    expect(swapped.freshness.incomingPreview?.attendanceChanges.map((c) => c.memberId)).toEqual(["M01", "M02"]);
    const reverted = SaveAttendanceResponseSchema.parse((await save({ baseAttendanceRevision: 1, members: roster() })).body);
    expect(reverted.freshness.incomingPreview?.current).toBe(true);
  });

  it("S1-09: a cross-origin save is rejected and writes nothing", async () => {
    const res = await request(api.app)
      .put(`/api/events/${E101}/attendance`)
      .set("Origin", "http://evil.example")
      .send({ baseAttendanceRevision: 0, members: roster({ M03: "attended" }) });
    expect(res.status).toBe(403);
    expect(await statuses()).toEqual(["M01:attended", "M02:absent", "M03:not_recorded", "M04:absent"]);
  });

  it("answers an unknown event with 404", async () => {
    const res = await request(api.app).put("/api/events/E999/attendance").send({ baseAttendanceRevision: 0, members: roster() });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test:integration`
Expected: PASS. If the T4-04 test is ever flaky, the lock is not taken before the revision check. Fix the service, never the test.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/event-api/src
git commit -m "feat(event-api): save attendance with revision checks, derived counts and freshness" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Explicit reset command and working agreements

**Files:**
- Create: `apps/event-api/src/scripts/reset-store.ts`, `apps/event-api/src/scripts/reset.ts`
- Modify: root `package.json` (`db:reset`), `AGENTS.md` (Commands table)
- Test: `apps/event-api/src/scripts/reset-store.test.ts`, `apps/event-api/src/scripts/reset-store.int.test.ts`

**Interfaces:**
- Consumes: `deleteKeysByPrefix`, `APPLICATION_KEY_PREFIXES` (Task 8); `loadConfig`, `loadDotEnv` (Task 1); `bootstrapStore` and the test helpers (Tasks 4, 6, 8).
- Produces:
  - `resetStore({ mysqlUrl, redisUrl, healthUrl, isApiRunning? }): Promise<ResetReport>`, where `ResetReport` is `{ database: string; deletedKeys: Record<string, number> }`.
  - `ResetRefusedError`, `resettableDatabase(mysqlUrl): string`, `apiAnswers(url): Promise<boolean>`.
  - `pnpm db:reset`.

- [ ] **Step 1: Write the failing tests**

`apps/event-api/src/scripts/reset-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ResetRefusedError, resettableDatabase } from "./reset-store.js";

describe("resettableDatabase", () => {
  it.each(["event_desk", "event_desk_test"])("allows %s", (name) => {
    expect(resettableDatabase(`mysql://u:p@127.0.0.1:3306/${name}`)).toBe(name);
  });

  it.each(["mysql", "production", "event_desk_2", ""])("refuses %j", (name) => {
    expect(() => resettableDatabase(`mysql://u:p@127.0.0.1:3306/${name}`)).toThrow(ResetRefusedError);
  });
});
```

`apps/event-api/src/scripts/reset-store.int.test.ts`:

```ts
import { createServer, type Server } from "node:http";
import type { Redis } from "ioredis";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapStore } from "../persistence/store-bootstrap.js";
import { openTestDataSource } from "../testing/database.js";
import { openTestRedis } from "../testing/redis.js";
import { silentLogger, testMysqlUrl, testRedisUrl } from "../testing/test-config.js";
import { apiAnswers, ResetRefusedError, resetStore } from "./reset-store.js";

const CLOSED_PORT_HEALTH = "http://127.0.0.1:4999/api/health";
let redis: Redis;

beforeAll(async () => {
  redis = await openTestRedis();
});
afterAll(async () => {
  await redis.del("other:keep");
  redis.disconnect();
  // Leave event_desk_test migrated and seeded for any test file that runs after this one.
  const dataSource = await openTestDataSource();
  await bootstrapStore(dataSource, silentLogger, new Date());
  await dataSource.destroy();
});

describe("apiAnswers", () => {
  it("is true while something answers the health URL and false on a closed port", async () => {
    const server: Server = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server has no port");
    try {
      expect(await apiAnswers(`http://127.0.0.1:${address.port}/api/health`)).toBe(true);
    } finally {
      server.close();
    }
    expect(await apiAnswers(CLOSED_PORT_HEALTH)).toBe(false);
  });
});

describe("resetStore", () => {
  it("refuses while the event API answers", async () => {
    await expect(
      resetStore({ mysqlUrl: testMysqlUrl(), redisUrl: testRedisUrl(), healthUrl: CLOSED_PORT_HEALTH, isApiRunning: () => Promise.resolve(true) }),
    ).rejects.toBeInstanceOf(ResetRefusedError);
  });

  it("F1-07: drops and recreates the database, deletes only application keys, and the next start reseeds", async () => {
    let dataSource: DataSource = await openTestDataSource();
    await bootstrapStore(dataSource, silentLogger, new Date());
    await dataSource.query("UPDATE members SET attendance = 'attended' WHERE id = 'M03'");
    await dataSource.destroy();
    await redis.set("event-desk:cache:event:E101:ver", "4");
    await redis.set("bull:briefing-batch:1", "job");
    await redis.set("other:keep", "1");

    const report = await resetStore({ mysqlUrl: testMysqlUrl(), redisUrl: testRedisUrl(), healthUrl: CLOSED_PORT_HEALTH });
    expect(report.database).toBe("event_desk_test");
    expect(report.deletedKeys["event-desk:"]).toBeGreaterThanOrEqual(1);
    expect(report.deletedKeys["bull:briefing-batch:"]).toBe(1);
    expect(await redis.exists("other:keep")).toBe(1);

    dataSource = await openTestDataSource();
    try {
      const tables = await dataSource.query<unknown[]>(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'event_desk_test'",
      );
      expect(tables).toHaveLength(0);
      await bootstrapStore(dataSource, silentLogger, new Date());
      const [chris] = await dataSource.query<{ attendance: string }[]>("SELECT attendance FROM members WHERE id = 'M03'");
      expect(chris?.attendance).toBe("not_recorded");
    } finally {
      await dataSource.destroy();
    }
  });
});
```

Run: `pnpm test && pnpm test:integration`
Expected: FAIL. `Failed to resolve import "./reset-store.js"`.

- [ ] **Step 2: Implement**

`apps/event-api/src/scripts/reset-store.ts`:

```ts
import { Redis } from "ioredis";
import { createConnection } from "mysql2/promise";
import { deleteKeysByPrefix } from "../integrations/delete-keys-by-prefix.js";
import { APPLICATION_KEY_PREFIXES } from "../integrations/redis-keys.js";

/** Reset refuses rather than guesses: a running API, or a database it does not own. */
export class ResetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResetRefusedError";
  }
}

const RESETTABLE_DATABASES = new Set(["event_desk", "event_desk_test"]);

export function resettableDatabase(mysqlUrl: string): string {
  const name = decodeURIComponent(new URL(mysqlUrl).pathname.slice(1));
  if (!RESETTABLE_DATABASES.has(name)) {
    throw new ResetRefusedError(`Refusing to reset "${name}": only event_desk and event_desk_test can be reset.`);
  }
  return name;
}

export async function apiAnswers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return true;
  } catch {
    return false;
  }
}

export interface ResetOptions {
  mysqlUrl: string;
  redisUrl: string;
  healthUrl: string;
  isApiRunning?: (healthUrl: string) => Promise<boolean>;
}

export interface ResetReport {
  database: string;
  deletedKeys: Record<string, number>;
}

/**
 * F1 explicit reset: drop and recreate the application database (attendance, briefings, previews,
 * generation snapshots and added notes), then delete only this application's Redis keys.
 * The next start migrates and reseeds E101.
 */
export async function resetStore(options: ResetOptions): Promise<ResetReport> {
  const database = resettableDatabase(options.mysqlUrl);
  if (await (options.isApiRunning ?? apiAnswers)(options.healthUrl)) {
    throw new ResetRefusedError(
      `Refusing to reset while the event API answers at ${options.healthUrl}. Stop the event API (and the AI Gateway) first.`,
    );
  }

  const server = new URL(options.mysqlUrl);
  server.pathname = "/";
  const connection = await createConnection(server.toString());
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  } finally {
    await connection.end();
  }

  const redis = new Redis(options.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2_000 });
  await redis.connect();
  try {
    const deletedKeys: Record<string, number> = {};
    for (const prefix of APPLICATION_KEY_PREFIXES) deletedKeys[prefix] = await deleteKeysByPrefix(redis, prefix);
    return { database, deletedKeys };
  } finally {
    redis.disconnect();
  }
}
```

`apps/event-api/src/scripts/reset.ts`:

```ts
import { loadConfig, loadDotEnv } from "../config/env.js";
import { ResetRefusedError, resetStore } from "./reset-store.js";

loadDotEnv(new URL("../../../../.env", import.meta.url));
const config = loadConfig();
const host = config.host.includes(":") ? `[${config.host}]` : config.host;

try {
  const report = await resetStore({
    mysqlUrl: config.mysqlUrl,
    redisUrl: config.redisUrl,
    healthUrl: `http://${host}:${config.port}/api/health`,
  });
  const keys = Object.entries(report.deletedKeys)
    .map(([prefix, count]) => `${prefix}* (${count})`)
    .join(", ");
  console.log(
    [
      "Reset complete.",
      `- MySQL database "${report.database}" dropped and recreated: saved attendance, briefings, previews,`,
      "  generation snapshots, outcomes and added feedback notes are gone.",
      `- Redis keys deleted: ${keys}. Other keys were left untouched.`,
      "Start the event API (pnpm dev) to migrate and reseed E101 with F01–F08.",
    ].join("\n"),
  );
} catch (error) {
  if (error instanceof ResetRefusedError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
```

Root `package.json` `scripts`: add `"db:reset": "pnpm --filter @event-desk/event-api db:reset",`.

- [ ] **Step 3: Run the tests**

Run: `pnpm test && pnpm test:integration`
Expected: PASS. Run the integration suite twice in a row to confirm the reset test leaves the database usable for the next run.

- [ ] **Step 4: Try the real command**

With the event API stopped:

```bash
pnpm db:reset
```

Expected: the "Reset complete." report for `event_desk`.

Then start the API (`pnpm dev`) and check that `curl -s http://127.0.0.1:4000/api/events/E101` shows the 4/1/2/1 seed. Run `pnpm db:reset` again while the API runs.
Expected: `Refusing to reset while the event API answers …` and exit code 1. Stop the API afterwards. Record the outputs.

- [ ] **Step 5: Update the working agreements**

In `AGENTS.md`, replace the Commands table rows with:

```markdown
| Command | What it does |
| --- | --- |
| `pnpm install` | Install the workspace |
| `cp .env.example .env` | First-time local configuration (local-only defaults for Docker Compose) |
| `pnpm infra:up` / `pnpm infra:down` | Start/stop MySQL 8.4 and Redis 8 (Docker Compose) |
| `pnpm dev` | Event API on http://127.0.0.1:4000 with reload (`/api/health`, `/api/events/E101`) |
| `pnpm verify` | Prettier check, ESLint, `tsc -b`, dependency-cruiser, unit tests: run before every commit |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:integration` | Integration tests against `event_desk_test` and Redis DB 1 (needs `pnpm infra:up`) |
| `pnpm arch` | Architecture rules only |
| `pnpm db:reset` | Explicit reset with the event API stopped: recreates `event_desk`, deletes `event-desk:*` and `bull:briefing-batch:*` keys; the next start reseeds E101 |
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm format && pnpm verify && pnpm test:integration`
Expected: exit 0.

```bash
git add apps/event-api/src package.json AGENTS.md
git commit -m "feat(event-api): explicit reset command that refuses while the API runs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Done when

- `pnpm verify` and `pnpm test:integration` pass on a clean checkout after `pnpm install` and `pnpm infra:up`.
- `GET /api/events/E101` returns the seeded event, exact notes and 4/1/2/1 counts, served from the versioned cache and correct after every change.
- `PUT /api/events/E101/attendance` saves atomically under the event row lock, rejects stale revisions and malformed bodies, and reports per-briefing freshness.
- Redis outages degrade to MySQL reads, and MySQL outages answer `503 STORE_UNAVAILABLE`. Startup never seeds over existing or unreachable data.
- `pnpm db:reset` restores the seed only while the API is stopped.
- `pnpm arch` enforces event-api layering, and every rule has been shown to fire.
- The CI workflow has an integration job. It runs on the first push.
