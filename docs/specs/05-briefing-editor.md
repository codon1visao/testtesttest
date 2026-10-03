# F5 — Briefing editing and saving

[All specifications](README.md) · [Source brief](../project-brief.md)

Status: **Confirmed by the user on 2026-10-03.** Text-only editing, explicit save, and saving a separate preview to replace the saved briefing (D1/D2).

## Outcome and scope

The coordinator inspects the sources of an already generated briefing, edits its wording only and explicitly saves it. The generated section/item structure, source associations and provenance remain unchanged. Reloading or restarting restores exactly the saved wording and references. This implements the brief's **Inspect and edit** outcome; it is not a blank-document authoring flow.

Contribution to the [client goal](README.md#product-goal-solve-the-client-situation): let the coordinator apply their judgment to make the briefing clear and useful, while keeping the original evidence available for review and preserving the wording they save.

## Editing flow

1. Open the selected generated preview or saved briefing in the editor. When a new incoming candidate is ready, use **Review new preview** to select it after resolving local edits; selection does not save/replace the saved briefing.
2. Show the attendance snapshot used for generation and the current saved counts beside the editable attendance overview.
3. Edit the overview and the text of themes, conflicts and suggestions.
4. Inspect the fixed references through [F3](03-feedback-and-sources.md). Reference IDs and original source notes are read-only; there are no controls to add, remove or reorder items.
5. Select **Save briefing**. When editing a preview while a saved briefing exists, label the action **Save and replace briefing** so its effect is explicit.
6. On success, display the persisted response as the new saved baseline. On failure, retain the complete local text draft and show retryable feedback.

Controls are labelled text areas for the overview and existing item text, with adjacent read-only source disclosure controls. Section labels and item positions remain fixed. No source checkboxes, item Add/Remove actions, drag reordering or rich-text document structure controls are provided.

Background generation may continue while this editor is open. A ready result only shows a notice. The selected preview remains stored and addressable by its generation ID, so automatic completion cannot invalidate the references/provenance needed to save typed text. The separate incoming slot and selection contract are defined in [F7](07-generation-queue.md#preview-ownership-and-the-editor).

## Human content and evidence rules

- The attendance overview remains editable, as the brief asks for an editable briefing. A saved human edit does not alter roster data or authoritative counts.
- Show a note that manually edited overview wording must be checked against the displayed counts. Automated factual consistency of arbitrary human text is not promised.
- Every generated theme, conflict and suggestion keeps its original position and reference IDs and requires nonblank edited text. Reuse the text bounds and section-specific reference validation from [F4](04-ai-briefing-generation.md#backend-validation), including at least two distinct valid IDs for a theme.
- Neither source associations nor the underlying notes can be changed by the coordinator. The backend retains them from the selected saved briefing or generated preview.
- Adding, deleting or moving section items is not allowed. Clearing text to whitespace fails validation rather than deleting the item. If a section was generated empty, it remains empty during text editing.
- Human editing does not make a stale briefing current. Generation provenance is read-only.
- Do not silently rewrite, summarize, regenerate or alter source associations during save.
- Trim only for validation; preserve the coordinator's actual saved wording and meaningful formatting such as line breaks. Reference normalization happens during generation, not human editing.
- Fixed references are not a guarantee of semantic support after text editing. Keep the evidence-limit notice and source inspection available; do not label saved human text as automatically verified.
- Theme wording should continue to describe the meaningful pattern or common concern supported by its fixed notes, following the [theme definition](04-ai-briefing-generation.md#theme-terminology). Changing it to a general topic label does not establish a theme, even when the retained IDs pass validation. This is a human review responsibility, not a claimed automated semantic check.

## When attendance changes during editing

Saving changed attendance must update the current counts and mark this editor out of date without changing its draft text, fixed references or generation snapshot. The coordinator can continue editing and save that wording; the saved result remains out of date. An attendance change does not require abandoning human edits or regenerate content automatically.

To obtain a new current briefing, resolve any unsaved text with Save or an explicit Discard, then Regenerate into a separate preview under [F6](06-freshness-and-regeneration.md). The previous saved human wording remains available until the coordinator saves the replacement. A failed attendance save does not change the persisted freshness baseline.

## API contract and provenance

`PUT /api/events/E101/briefing` accepts `{ baseBriefingRevision, generationId, textEdits }`, where `textEdits` uses `BriefingTextEdits` from the [index](README.md#briefing-content-contract). It contains the overview string and arrays of item-text strings, not source IDs or full evidence objects.

The backend resolves `generationId` against the current saved briefing or selected generated preview, never directly against the incoming slot. It copies the corresponding server-owned item structure, references and generation provenance. A missing/expired generation ID returns `409 GENERATION_NOT_AVAILABLE`; do not accept a client-provided snapshot or arbitrary generation ID.

Require every text section and the exact number of entries from that selected generation. Each array position updates only that original item's text; it never changes its reference association. Reject added/missing entries, evidence objects, source-ID fields, provenance fields and unknown sections. Revalidate the retained references against the supplied notes before writing; do not save corrupt associations merely because the client did not submit them.

Within one serialized persistent update, compare the baseline briefing revision, apply and validate text edits against the selected server record, and save the resulting wording with its unchanged references and provenance. Reject stale revisions with `409 BRIEFING_CONFLICT`. Advance `briefingRevision` on a real change to content or generation provenance; a no-op does not need a new revision. Return full saved content and freshness computed from the current saved attendance, not a client-supplied flag.

Saving a preview promotes it to the saved briefing and clears that same preview slot. It must not clear a different preview generated by a later request. Editing an already saved briefing does not discard an unrelated generated preview. A first save uses `baseBriefingRevision: 0`.

## Saved and unsaved states

| State | Behaviour |
| --- | --- |
| No briefing or preview | Show Generate entry point; do not fabricate a draft |
| Preview | Mark “Generated preview — not saved as briefing”; saved briefing stays available |
| Editing | Mark unsaved changes; source inspection remains available |
| Saving | Prevent duplicate saves and changes to submitted editor fields until resolution |
| Saved | Show a clear success indication and last saved time |
| Validation failed | Identify the section/item and problem; preserve all draft text and fixed references |
| Save failed | Preserve draft and last confirmed saved briefing; show Retry |
| Revision conflict | Preserve local draft; show current saved state for review without replaying an overwrite automatically |

Display **Discard edits** when dirty; require explicit confirmation before losing local human changes. Switching between preview and saved content or regenerating while dirty follows [F6](06-freshness-and-regeneration.md). Refresh/closing may lose unsaved local changes; use a browser exit warning where supported and distinguish this from guaranteed persistence of saved work.

A lost save response may mean the write succeeded. Re-fetch and compare the content/generation ID before reporting an outcome. Keep the local draft until the coordinator can reconcile an ambiguous result.

## Acceptance criteria

| ID | Given / when | Expected result |
| --- | --- | --- |
| F5-01 | Generate, inspect an item's source notes, edit its wording and save | Saved response contains the human text with exactly the original reference IDs on that item |
| F5-02 | Refresh browser and restart backend after save | Saved wording, references and provenance remain unchanged |
| F5-03 | Submit source-ID fields or full evidence objects, even with valid IDs | Request rejected; original references unchanged and no partial save |
| F5-04 | Submit extra/missing item text, an unknown section or blank item text | Validation fails; original structure remains and local draft is retained |
| F5-05 | Open sources while typing | Local wording and editor state survive inspection; references remain read-only |
| F5-06 | Save fails or two tabs save from the same revision | Failed/stale save cannot overwrite newer saved work; local draft retained |
| F5-07 | Edit and save a stale briefing | Human wording persists but stale status remains |
| F5-08 | Edit the attendance overview | Roster/counts unchanged; snapshot and current counts remain inspectable |
| F5-09 | Save a preview while a prior briefing exists | Explicit replacement action; only then is the saved briefing replaced |
| F5-10 | Discard edits or try to switch drafts while dirty | Explicit choice before losing human changes; cancelling preserves them |
| F5-11 | Submit altered provenance fields | Request rejected; freshness cannot be reset by client metadata |
| F5-12 | Save changed attendance while this editor has unsaved text | Out-of-date warning and counts update in place; draft text and original references survive |
| F5-13 | A retained stored reference is invalid or the selected generation is unavailable | Save rejected clearly; no silent reference substitution or binding to another preview |
| F5-14 | An automatic generation completes during text editing | The old selected generation remains saveable with its original references; incoming content does not alter fields or focus |

## Dependencies and discussion

Depends on [F3](03-feedback-and-sources.md), [F4](04-ai-briefing-generation.md) and [F6](06-freshness-and-regeneration.md). [D2](README.md#decisions) confirms text-only editing. The read-only reference associations preserve the generated source links while the coordinator reviews and revises wording.
