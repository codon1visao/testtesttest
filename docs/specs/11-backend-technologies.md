# T2 — Backend technologies and shared conventions

[All specifications](README.md) · [Frontend technologies](10-frontend-technologies.md)

Status: **User-selected technologies and repository conventions, confirmed on 2026-10-02.** Queue and TCP library recommendations remain open. Application implementation has not started.

## Selected stack

| Area | Choice |
| --- | --- |
| Runtime | Node.js and TypeScript |
| HTTP framework | Express |
| Database access | MongoDB through Mongoose, behind the repository layer |
| API response caching | Redis |
| Validation | Zod |
| AI | OpenAI Agents SDK, used exclusively inside the internal AI Gateway |
| Internal communication | TCP; concrete transport library remains open |
| Package management | pnpm for both frontend and backend |
| Backend organisation | pnpm monorepo inside the root `backend/` directory |
| Architecture | Layered, including a repository layer |
| Naming | Kebab-case folders and filenames |

Use [Mongoose](https://mongoosejs.com/docs/) for database schemas/models and persistence. Zod owns API/TCP boundary contracts; shared types and rules should be reused rather than independently rewritten in each layer. Mongoose models stay behind repositories and do not become frontend contracts.

## Shared clean-code conventions

For both frontend and backend: use clear names, focused functions/components, explicit error handling and readable types. Keep responsibilities in their intended layers. Reuse existing functions, APIs, DTOs, schemas and hooks; avoid duplicate logic and abstractions without a current use. Kebab-case applies to folders/files; normal TypeScript and React identifier conventions still apply. Multiple related frontend components may share a file.

For the backend, the normal path is **routes/controllers → services → repositories → Mongoose/MongoDB**. Controllers handle transport concerns, services implement business rules, and repositories own database access. Queue handlers reuse services. AI execution and provider credentials remain exclusively in the separate Gateway under [F8](09-ai-gateway.md).

Redis caches eligible API read responses with expiry and invalidation after relevant changes. MongoDB remains authoritative: cached data must not decide save conflicts, generation inputs or freshness. Cache handling must preserve accurate attendance, current job status and preview availability; volatile state must be read live unless a correct invalidation policy is established.

## Remaining implementation choices

BullMQ for queue execution, ioredis for Redis access and Node's native TCP transport are recommendations, not confirmed selections. Redis caching does not implicitly select Redis queue storage. The [fixed-window and FIFO requirements](07-generation-queue.md) apply to whichever queue is selected. Exact versions, document layout, indexes, cache policy and package linking remain to be specified.

No application packages have been created or dependencies installed. Additional production dependencies require confirmation under the repository working agreements.
