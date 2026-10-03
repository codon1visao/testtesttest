# 0016. Normalised schema with composite foreign keys

Status: Accepted (2026-10-03) · Spec: [D15](../specs/README.md#decisions), [T4 §3–4](../specs/13-data-model-and-transactions.md)

## Context
The evidence rules (cite only captured notes; saving cannot change references) are central to trust.

## Options
JSON document columns validated in code; normalised tables with composite foreign keys.

## Decision
Normalised tables. Composite FKs make the database reject a citation of a note outside that
generation's input and a saved text row for another generation's item. `preview_slots` holds the
selected and incoming previews; IDs use binary collation; CHECK constraints reject blank text.

## Consequences
More tables and hand-written migrations, in exchange for integrity that survives application bugs. Rules
the database cannot express (minimum distinct notes) stay in `validateEvidenceSections()`.
