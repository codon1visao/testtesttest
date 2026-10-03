# 0014. Retry is Generate again

Status: Accepted (2026-10-03) · Spec: [D13](../specs/README.md#decisions), [F4](../specs/04-ai-briefing-generation.md)

## Context
After a failed manual generation the coordinator needs a way to try again.

## Options
A retry endpoint that replays the failed request; the Retry button sends a normal Generate request.

## Decision
No retry endpoint. Retry calls Generate, capturing current saved inputs with a fresh run ID. After
`AI_OUTCOME_UNKNOWN` the UI asks for confirmation, because the earlier call may have been charged.

## Consequences
One code path for both buttons. Automatic retries exist only for batch jobs, owned by BullMQ.
