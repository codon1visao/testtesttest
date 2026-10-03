# 0003. Briefing edits change text only

Status: Accepted (2026-10-02) · Spec: [D2](../specs/README.md#decisions), [F5](../specs/05-briefing-editor.md)

## Context
The coordinator edits generated wording; the brief requires saved wording and references to survive.

## Options
Free-form document editing; editing text plus references; editing text only.

## Decision
Edits change the text of existing items only. Section structure, item positions, source IDs and
provenance are copied from the server-owned generation; the save payload carries strings, not evidence.

## Consequences
References can never be forged or dropped by a save, and the schema enforces it (ADR 0016). Edited text
may drift from its sources; the UI keeps sources inspectable and says that references are not proof.
