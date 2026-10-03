# 0013. A conflict cites at least two notes

Status: Accepted (2026-10-03) · Spec: [D12](../specs/README.md#decisions), [T3 §4](../specs/12-architecture-and-repository.md#4-shared-contracts-package)

## Context
A disagreement lives between notes. With one cited note the coordinator could open only one side, which
erases the opposing view the brief tells us to keep.

## Options
One note minimum; two distinct notes minimum; a nested positions model with notes per side.

## Decision
Every conflict cites at least two distinct notes, one per opposing view, and is worded as a difference
between notes, never between counted people. Themes also need two notes; suggestions and the summary one.

## Consequences
A structural guarantee that both sides are inspectable, without changing the content or edit contracts.
Whether each side is described faithfully stays a human review step.
