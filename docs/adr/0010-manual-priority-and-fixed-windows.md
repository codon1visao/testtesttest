# 0010. Manual priority and fixed batch windows

Status: Accepted (2026-10-03) · Spec: [D9](../specs/README.md#decisions), [F7](../specs/07-generation-queue.md)

## Context
Automatic work must never block or overwrite the coordinator's own generation, and bursts of notes
must not multiply paid calls.

## Options
Queue manual work too with priorities; latest-request-wins with FIFO winners (earlier design);
synchronous manual generation plus fixed windows that read data at run time.

## Decision
Manual Generate is synchronous and single-flight, with its own Gateway lane, a reserved budget and
priority in the incoming slot. New notes open a fixed 3-second window; one job per window reads all
notes when it runs and skips when nothing changed.

## Consequences
A manual request holds an HTTP request open (acceptable for one coordinator). Reading at run time removes
ordering problems between jobs. Single-flight is in-process, so one event-api instance runs.
