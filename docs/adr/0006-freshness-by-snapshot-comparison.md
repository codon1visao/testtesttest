# 0006. Freshness by snapshot comparison

Status: Accepted (2026-10-03) · Spec: [D5](../specs/README.md#decisions), [F6](../specs/06-freshness-and-regeneration.md)

## Context
The brief: if attendance changes, mark the briefing out of date. It does not define what an exact revert
means.

## Options
Stale forever after any change (revision counter); compare the generation's captured input with current
saved data.

## Decision
Compare each generation's per-member attendance snapshot and feedback digest with current data. A swap
is two changes; an exact revert is current again. `computeFreshness()` is a pure function in contracts.

## Consequences
Warnings appear only for real differences and can name them ("Chris: Not recorded → Attended"). Revision
counters stay purely for write conflicts. Snapshots are stored per generation (not attendance history).
