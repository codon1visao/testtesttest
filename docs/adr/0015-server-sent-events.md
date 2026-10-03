# 0015. Server-Sent Events for live updates

Status: Accepted (2026-10-03) · Spec: [D14](../specs/README.md#decisions), [T3 §7](../specs/12-architecture-and-repository.md#7-response-cache-a4)

## Context
Notes added by the script, batch progress and results must appear without a reload.

## Options
Polling only; Server-Sent Events; WebSockets.

## Decision
`GET /api/events/:id/changes` streams a `changed` message on every cache flush; the client re-fetches
the cached event read. Polling is the fallback when the stream drops.

## Consequences
One-way and dependency-free on both sides. The notifier is in-process, so it assumes one event-api
instance.
