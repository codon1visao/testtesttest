# 0009. Internal AI Gateway over TCP

Status: Accepted (2026-10-02; transport 2026-10-03) · Spec: [D8](../specs/README.md#decisions), [F8](../specs/09-ai-gateway.md)

## Context
The user wants every AI call to go through one service that alone holds provider credentials.

## Options
Call OpenAI from the event backend; a separate Gateway over HTTP; a separate Gateway over TCP.

## Decision
`apps/ai-gateway` is the only OpenAI caller. The event backend calls it over Node `net` with
length-prefixed JSON frames, one connection per attempt, a shared secret compared in constant time,
loopback only, and two lanes (`interactive`, `background`) with one call each.

## Consequences
Centralised credentials and AI policy, at the cost of a second process and new failure modes
(`GATEWAY_UNAVAILABLE`, `AI_OUTCOME_UNKNOWN`). There is no direct-provider fallback.
