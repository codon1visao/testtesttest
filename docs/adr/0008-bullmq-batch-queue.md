# 0008. BullMQ for feedback batches

Status: Accepted (2026-10-03) · Spec: [D7](../specs/README.md#decisions), [T5](../specs/14-generation-queue-implementation.md)

## Context
Automatic generation needs fixed windows, one job at a time, bounded retries with backoff, and recovery
after a crash.

## Options
A MySQL-backed queue (rejected by the user); BullMQ on Redis; Temporal.

## Decision
BullMQ: throttle de-duplication (`ttl` = window) plus `delay` = window, worker concurrency 1, built-in
attempts with a provider-aware backoff. MySQL records outcomes; jobs carry no candidate data.

## Consequences
Redis must run with AOF and `noeviction`. The behaviour is verified by a spike before anything is built
on it (`docs/spikes/bullmq-window.md`). Temporal stays possible behind the same port.
