# 0018. Versioned Redis cache for the event read

Status: Accepted (2026-10-03) · Spec: [T3 A4 and §7](../specs/12-architecture-and-repository.md#7-response-cache-a4)

## Context
`GET /api/events/:id` is read often (SSE-triggered refetches) and assembled from several queries. A plain
delete-on-write cache lets a slow reader write stale data back after a writer's delete.

## Options
No cache; delete-on-write; a version counter in the key.

## Decision
Cache the event view under `event-desk:cache:event:{id}:v{ver}`. Reads use the version read before the
database query; every commit or queue change does `INCR ver` then `DEL v{old}`. TTL 30 s, capped at the
next time-driven state change. If Redis is down, read MySQL; if a flush fails, bypass the cache until one
succeeds.

## Consequences
A late write lands on a retired key nobody reads. MySQL stays authoritative; freshness is computed while
building the view, never decided by the cache.
