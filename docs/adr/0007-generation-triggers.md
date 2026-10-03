# 0007. Two generation triggers

Status: Accepted (2026-10-03) · Spec: [D6](../specs/README.md#decisions), [F7](../specs/07-generation-queue.md)

## Context
The coordinator generates on demand. The user also wants briefings to follow new feedback.

## Options
Manual only; manual plus automatic generation on new notes.

## Decision
Two triggers: the coordinator's Generate, and new notes added through a test feedback form or script
that stand in for the club's real feedback form.

## Consequences
Needs a test-only submission path (an extension beyond the brief) and batching (ADR 0010) so a burst of
notes does not cause a burst of paid calls.
