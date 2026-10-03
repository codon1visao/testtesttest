# 0012. Backend stack and one pnpm workspace

Status: Accepted (2026-10-02; layout 2026-10-03) · Spec: [D11](../specs/README.md#decisions), [T2](../specs/11-backend-technologies.md), [T3](../specs/12-architecture-and-repository.md)

## Context
Three apps share contracts; the project must show deliberate layering.

## Options
Separate repositories; `frontend/` + `backend/` folders; one pnpm workspace with `apps/*` and `packages/*`.

## Decision
One root pnpm workspace: `apps/web`, `apps/event-api`, `apps/ai-gateway`, `packages/contracts`,
`packages/tcp-rpc`. Express 5, Zod, layered services with ports and adapters, explicit composition
roots. Docker Compose runs only MySQL and Redis.

## Consequences
A package exists only with more than one consumer. dependency-cruiser enforces layer and provider
boundaries in CI.
