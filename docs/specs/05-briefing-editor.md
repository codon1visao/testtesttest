# F5 — Briefing editing and saving

[All specifications](README.md) · [Source brief](../project-brief.md)

Status: **Confirmed by the user on 2026-10-03.** Text-only editing, explicit save, and saving a separate preview to replace the saved briefing (D1/D2). Amended 2026-10-04 (user-approved): read view first, Edit briefing and Cancel edit. Amended 2026-10-04 (user-approved): the actions sit in the briefing header — read view **Edit** and **Generate**, edit view **Cancel** and **Save**; saving happens only from the edit view, and the button reads **Save** in every case. Amended 2026-10-04 (user-approved): the editor title is visually hidden and an **Unsaved preview** badge in the briefing header marks a generated preview; the attendance overview is no longer shown or edited (still generated, stored and saved unchanged); the provenance line is not shown. Amended 2026-10-04 (user-approved): a generated preview in the read view offers **Accept preview** (saves it unchanged as the saved briefing) next to **Edit**, instead of **Generate**.

## Outcome and scope

The coordinator inspects the sources of an already generated briefing, edits its wording only and explicitly saves it. The generated section/item structure, source associations and provenance remain unchanged. Reloading or restarting restores exactly the saved wording and references. This implements the brief's **Inspect and edit** outcome; it is not a blank-document authoring flow.

Contribution to the [client goal](README.md#product-goal-solve-the-client-situation): let the coordinator apply their judgment to make the briefing clear and useful, while keeping the original evidence available for review and preserving the wording they save.

## Editing flow

1. Open the selected generated preview or saved briefing in the editor. When a new incoming candidate is ready, use **Review new preview** to select it after resolving local edits; selection does not save/replace the saved briefing. The briefing opens in a read view — the highlighted summary, themes and disagreements side by side, then suggestions. The briefing header holds the actions: in the read view **Edit** and **Generate** for the saved briefing, or **Edit** and **Accept preview** (primary) for a generated preview; **Edit** opens the text areas, and the header then offers **Cancel** and **Save** instead. **Accept preview** is the read view's way to save a preview: it saves it unchanged as the saved briefing (replacing any earlier one) through the same save as the edit view's **Save** (its generation ID, the editor's briefing revision, the unchanged text). Its failures show the same notices as Save; a server field error, which has no text area on screen, is shown in the error banner.
2. The editor's title ("Generated preview — not saved as briefing" or "Saved briefing") is visually hidden: it names the briefing for assistive technology and takes focus after cancel, discard, reload, save and switch. On screen, an **Unsaved preview** badge beside the **Briefing** heading marks a generated preview; it is absent for the saved briefing. The generation provenance (time, model, trigger) is stored but not shown. The current saved counts are in the attendance tiles ([F2](02-attendance.md)); when the briefing is out of date, the freshness notice lists the generation snapshot beside them ([F6](06-freshness-and-regeneration.md)).
3. Edit the feedback summary and the text of themes, conflicts and suggestions. The attendance overview is neither shown nor edited (user decision 2026-10-04): it is still generated in code, stored, and saved unchanged with every save.
4. Inspect the fixed references through [F3](03-feedback-and-sources.md). Reference IDs and original source notes are read-only; there are no controls to add, remove or reorder items.
5. Select **Save** in the edit view. The label is **Save** in every case; when the edit view shows a preview while a saved briefing exists, the **Unsaved preview** badge (and the hidden title "Generated preview — not saved as briefing") makes the effect explicit: saving replaces the saved briefing. A selected preview can be saved without changing its text, here or with **Accept preview** in the read view.
6. On success, display the persisted response as the new saved baseline. On failure, retain the complete local text draft and show retryable feedback.

Controls are labelled text areas for the feedback summary and existing item text, with adjacent read-only source disclosure controls. Section labels and item positions remain fixed. No source checkboxes, item Add/Remove actions, drag reordering or rich-text document structure controls are provided.

Background generation may continue while this editor is open. A ready result only shows a notice. The selected preview remains stored and addressable by its generation ID, so automatic completion cannot invalidate the references/provenance needed to save typed text. The separate incoming slot and selection contract are defined in [F7](07-generation-queue.md#preview-ownership-and-the-editor).

## Human content and evidence rules

- The attendance overview is not editable in the UI (amended 2026-10-04): every save sends it unchanged from the briefing being edited. The API still accepts it, and no edit alters roster data or authoritative counts. A server error about it has no field to land on and is shown in the save banner.
- The feedback summary, like every generated theme, conflict and suggestion, keeps its original position and reference IDs and requires nonblank edited text. Reuse the text bounds and section-specific reference validation from [F4](04-ai-briefing-generation.md#backend-validation), including at least two distinct valid IDs for a theme.
- Neither source associations nor the underlying notes can be changed by the coordinator. The backend retains them from the selected saved briefing or generated preview.
- Adding, deleting or moving section items is not allowed. Clearing text to whitespace fails validation rather than deleting the item. If a section was generated empty, it remains empty during text editing.
- Human editing does not make a stale briefing current. Generation provenance is read-only.
- Do not silently rewrite, summarize, regenerate or alter source associations during save.
- Trim only for validation; preserve the coordinator's actual saved wording and meaningful formatting such as line breaks. Reference normalization happens during generation, not human editing.
- Fixed references are not a guarantee of semantic support after text editing. Keep the evidence-limit note (at the bottom of every opened sources view) and source inspection available; do not label saved human text as automatically verified.
- Theme wording should continue to describe the meaningful pattern or common concern supported by its fixed notes, following the [theme definition](04-ai-briefing-generation.md#theme-terminology). Changing it to a general topic label does not establish a theme, even when the retained IDs pass validation. This is a human review responsibility, not a claimed automated semantic check.

## When attendance changes during editing

Saving changed attendance must update the current counts and mark this editor out of date without changing its draft text, fixed references or generation snapshot. The coordinator can continue editing and save that wording; the saved result remains out of date. An attendance change does not require abandoning human edits or regenerate content automatically.

To obtain a new current briefing, resolve any unsaved text with Save or an explicit Discard, then Regenerate into a separate preview under [F6](06-freshness-and-regeneration.md). The previous saved human wording remains available until the coordinator saves the replacement. A failed attendance save does not change the persisted freshness baseline.

## API contract and provenance

`PUT /api/events/E101/briefing` accepts `{ baseBriefingRevision, generationId, textEdits }`, where `textEdits` uses `BriefingTextEdits` from the [index](README.md#briefing-content-contract). It contains the overview string (sent unchanged by the UI), the feedback summary and arrays of item-text strings, not source IDs or full evidence objects.

The backend resolves `generationId` against the current saved briefing or selected generated preview, never directly against the incoming slot. It copies the corresponding server-owned item structure, references and generation provenance. A missing/expired generation ID returns `409 GENERATION_NOT_AVAILABLE`; do not accept a client-provided snapshot or arbitrary generation ID.

Require every text section and the exact number of entries from that selected generation. Each array position updates only that original item's text; it never changes its reference association. Reject added/missing entries, evidence objects, source-ID fields, provenance fields and unknown sections. Revalidate the retained references against the supplied notes before writing; do not save corrupt associations merely because the client did not submit them.

Within one serialized persistent update, compare the baseline briefing revision, apply and validate text edits against the selected server record, and save the resulting wording with its unchanged references and provenance. Reject stale revisions with `409 BRIEFING_CONFLICT`. Advance `briefingRevision` on a real change to content or generation provenance; a no-op does not need a new revision. Return full saved content and freshness computed from the current saved attendance, not a client-supplied flag.

Saving a preview promotes it to the saved briefing and clears that same preview slot. It must not clear a different preview generated by a later request. Editing an already saved briefing does not discard an unrelated generated preview. A first save uses `baseBriefingRevision: 0`.

## Saved and unsaved states

| State | Behaviour |
| --- | --- |
| No briefing or preview | Show Generate entry point; do not fabricate a draft |
| Preview | An **Unsaved preview** badge beside the Briefing heading (the editor's visually hidden title reads “Generated preview — not saved as briefing”); the read view offers **Edit** and **Accept preview**, not **Generate**; saved briefing stays available |
| Editing | Mark unsaved changes; source inspection remains available |
| Saving | Prevent duplicate saves and changes to submitted editor fields until resolution |
| Saved | Show a clear success indication; no Unsaved preview badge; the editor's visually hidden title reads "Saved briefing" |
| Validation failed | Identify the section/item and problem; preserve all draft text and fixed references |
| Save failed | Preserve draft and last confirmed saved briefing; show Retry |
| Revision conflict | Preserve local draft; show current saved state for review without replaying an overwrite automatically |

In the edit view, **Cancel** sits beside **Save** in the briefing header: without changes it closes the text areas; with unsaved changes it requires explicit confirmation before losing them. **Generate** is not offered while the text areas are open, nor while a generated preview is shown. Switching between preview and saved content or regenerating while dirty follows [F6](06-freshness-and-regeneration.md). Refresh/closing may lose unsaved local changes; use a browser exit warning where supported and distinguish this from guaranteed persistence of saved work.

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
| F5-08 | Edit and save a briefing | The attendance overview is neither shown nor editable and is saved unchanged; roster/counts unchanged; current counts stay in the tiles and an out-of-date briefing's notice lists its snapshot |
| F5-09 | Save a preview while a prior briefing exists | The replacement happens only on **Accept preview** in the preview's read view (unchanged text) or **Save** from its edit view, marked **Unsaved preview**; until then the saved briefing is unchanged |
| F5-10 | Cancel with changes or try to switch drafts while dirty | Explicit choice before losing human changes; cancelling preserves them |
| F5-11 | Submit altered provenance fields | Request rejected; freshness cannot be reset by client metadata |
| F5-12 | Save changed attendance while this editor has unsaved text | Out-of-date warning and counts update in place; draft text and original references survive |
| F5-13 | A retained stored reference is invalid or the selected generation is unavailable | Save rejected clearly; no silent reference substitution or binding to another preview |
| F5-14 | An automatic generation completes during text editing | The old selected generation remains saveable with its original references; incoming content does not alter fields or focus |

## Dependencies and discussion

Depends on [F3](03-feedback-and-sources.md), [F4](04-ai-briefing-generation.md) and [F6](06-freshness-and-regeneration.md). [D2](README.md#decisions) confirms text-only editing. The read-only reference associations preserve the generated source links while the coordinator reviews and revises wording.
