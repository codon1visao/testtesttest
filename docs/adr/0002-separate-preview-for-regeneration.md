# 0002. Regeneration writes a separate preview

Status: Accepted (2026-10-02) · Spec: [D1](../specs/README.md#decisions), [F6](../specs/06-freshness-and-regeneration.md)

## Context
The brief: regeneration must not silently overwrite saved human edits.

## Options
Replace in place after a confirmation; generate into a separate preview; keep full version history.

## Decision
Generation only ever writes a preview slot. Only the coordinator's explicit Save (labelled
"Save and replace briefing" when a saved briefing exists) replaces the saved briefing.

## Consequences
Saved work is structurally protected: no code path from generation reaches the saved briefing. The UI
must show saved and preview content distinctly. No version history is needed.
