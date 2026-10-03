# T2 — Backend technologies and shared conventions

[All specifications](README.md) · [Frontend technologies](10-frontend-technologies.md)

Status: **Confirmed by the user on 2026-10-02; updated 2026-10-03** (MySQL/TypeORM, root `apps/` + `packages/` workspace, BullMQ, native `net` TCP, T4 schema). Application implementation has not started.

## Selected stack

| Area | Choice |
| --- | --- |
| Runtime | Node.js and TypeScript |
| HTTP framework | Express |
| Database access | MySQL 8.4 through TypeORM (`mysql2` driver, `EntitySchema` definitions), behind the repository layer |
| API response caching | Redis: the single event read, flushed after every write |
| Batch queue | BullMQ on the same Redis (`noeviction`, AOF); confirmed 2026-10-03 |
| Live updates | Server-Sent Events from Express (`GET /api/events/:id/changes`); no extra dependency |
| Validation | Zod |
| AI | OpenAI Agents SDK, used exclusively inside the internal AI Gateway |
| Internal communication | TCP via Node's native `net` with the shared `packages/tcp-rpc` length-prefixed framing |
| Package management | pnpm for both frontend and backend |
| Repository organisation | One root pnpm workspace: `apps/web`, `apps/event-api`, `apps/ai-gateway`, `packages/contracts`, `packages/tcp-rpc` |
| Local infrastructure | Docker Compose runs MySQL and Redis only; apps run locally with `pnpm dev` |
| Architecture | Layered, including a repository layer |
| Naming | Kebab-case folders and filenames |

Use [TypeORM](https://typeorm.io/) for entities, migrations and transactions. Define entities with `EntitySchema` rather than decorators, because `tsx` and Vitest compile with esbuild, which does not emit decorator metadata. Keep `synchronize` disabled and use versioned migrations. Zod owns API/TCP boundary contracts and validates loaded rows/JSON columns; shared types and rules are reused rather than rewritten in each layer. TypeORM entities stay behind repositories and do not become frontend contracts.

## Shared clean-code conventions

For both frontend and backend: use clear names, focused functions/components, explicit error handling and readable types. Keep responsibilities in their intended layers. Reuse existing functions, APIs, DTOs, schemas and hooks; avoid duplicate logic and abstractions without a current use. Kebab-case applies to folders/files; normal TypeScript and React identifier conventions still apply. Multiple related frontend components may share a file.

For the backend, the normal path is **routes/controllers → services → repositories → TypeORM/MySQL**. Controllers handle transport concerns, services implement business rules, and repositories own database access. Queue handlers reuse services. AI execution and provider credentials remain exclusively in the separate Gateway under [F8](09-ai-gateway.md).

Redis caches the `GET /api/events/:eventId` response. Every committed write and queue-state change flushes it by bumping a version counter and deleting the old key, so a read racing with a write cannot repopulate stale data; TTL is capped at the next time-driven state change. If a flush fails, reads bypass the cache until a flush succeeds. MySQL remains authoritative: cached data never decides save conflicts, generation inputs or freshness. Details: [T3 §7](12-architecture-and-repository.md#7-response-cache-a4).

## Remaining implementation choices

BullMQ for batch execution is confirmed (D7, 2026-10-03), with a behaviour spike as the first build step ([T5 §6](14-generation-queue-implementation.md#6-spike-first-build-step)). ioredis for Redis access and Node's native `net` TCP transport are confirmed (T3). A database-backed queue was rejected. The [fixed-window and FIFO requirements](07-generation-queue.md) apply unchanged. Exact versions and the final table/index list remain to be fixed during implementation.

No application packages have been created or dependencies installed. Additional production dependencies require confirmation under the repository working agreements.
