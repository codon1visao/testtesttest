# F6 — Freshness and safe regeneration

[All specifications](README.md) · [Source brief](../project-brief.md)

Status: **Confirmed by the user on 2026-10-03.** Snapshot-comparison freshness (D5), separate previews (D1) and protection of saved human edits. Amended 2026-10-04 (user-approved): Generate is not offered while the briefing is being edited (save or cancel first); a result arriving from elsewhere while editing is still held as an incoming preview (F6-09); nothing is shown when the briefing is current. Amended 2026-10-04 (user-approved): attendance saves on each change ([F2](02-attendance.md)), so there is no unsaved attendance draft; Generate waits while an attendance save is in flight (superseded: explicit save restored, see below). Amended 2026-10-04 (user-approved): explicit attendance save restored — unsaved attendance changes block Generate until saved or discarded. The freshness logic is unchanged. Amended 2026-10-04 (user-approved): Generate is not offered while a generated preview is shown in the read view or while the briefing is being edited — accept the preview (or switch to the saved briefing) to generate again; the batch banner's **Generate now** follows the same rule.

## Outcome and scope

The coordinator can tell when a briefing reflects older attendance and can generate a replacement without silently losing saved wording or local edits.

Contribution to the [client goal](README.md#product-goal-solve-the-client-situation): keep the briefing trustworthy as the attendance record is corrected. The coordinator must be able to distinguish an older account from current records and retain editorial work while deciding whether to replace it.

This feature owns shared state transitions across [attendance](02-attendance.md), [generation](04-ai-briefing-generation.md) and [editing](05-briefing-editor.md). Automatic batching, the incoming-slot rules and explicit preview selection belong to [F7](07-generation-queue.md); no history subsystem is required.

## Freshness rule

The brief requires: **If attendance changes, mark the briefing as out of date.** It does not prescribe revision numbers, history records or a particular change-detection algorithm.

- An actual saved attendance change marks any older preview/saved briefing out of date.
- If an editor is open, update its out-of-date warning and current counts in place. Preserve its unsaved text, original source references and generation baseline. Do not automatically regenerate or replace its overview wording.
- Unsaved attendance changes do not change the persisted stale flag. Show the separate unsaved-attendance state (the Unsaved badge and draft counts) and block manual generation until the changes are saved or discarded ("Save or discard your attendance changes before generating."). Automatic work uses saved attendance and does not read or save browser drafts.
- A newly added feedback note (test form or script, [F3](03-feedback-and-sources.md#adding-feedback-test-extension)) also makes earlier content out of date and schedules an automatic batch under F7. Show what changed: the changed members and/or the new note IDs (for example “2 new notes since this briefing: F09, F10”). Existing source IDs and texts never change.
- No-op saves do not make a current briefing stale.
- Changing members while leaving aggregate counts equal still makes the briefing stale.
- Editing or saving briefing text does not change the generation baseline.
- The brief does not specify what happens after an exact revert. D5 (confirmed 2026-10-03): freshness compares the briefing's stored per-member attendance snapshot with current saved statuses, so an exact revert makes the briefing current again, because it again matches the saved records. Show which members changed (for example “Chris: Not recorded → Attended”).
- Show the baseline counts and current saved counts so the coordinator can understand what changed. Do not replace the old overview automatically.

Use visible text such as **Out of date — attendance changed since this briefing was generated**. When the briefing is current, show no freshness text at all. Keep the content readable and editable, and offer Regenerate. A stale briefing may still be saved with its warning; staleness must not cause loss of editorial work.

### Mechanism (D5, confirmed)

Compare each briefing's stored input snapshot with current saved data:

```text
isStale = attendanceChangedSinceGeneration || feedbackChangedSinceGeneration
```

`attendanceChangedSinceGeneration` is true when any member's current saved status differs from the status in the generation's snapshot (so a swap with equal counts is still detected). `feedbackChangedSinceGeneration` compares a digest of the current `[id, text]` list with the snapshot's digest. The revision counters are confirmed for write conflicts only and do not decide freshness. The snapshot is stored anyway so the editor can show the counts used for generation; it is not attendance version history. The shared `computeFreshness()` lives in `packages/contracts` ([T3](12-architecture-and-repository.md#6-persistence--mysql-84--typeorm)).

## Example: edit, save, change attendance, regenerate

1. With saved seed counts 4 registered / 1 attended / 2 absent / 1 not recorded, generate a briefing preview from those saved records.
2. Inspect F05/F06, edit the text of their generated rest-break item and Save. Its original references remain F05/F06, and the human wording survives refresh/restart.
3. Change Chris from Not recorded to Attended. The attendance controls immediately show unsaved counts (`1 → 2` attended, `1 → 0` not recorded) under an Unsaved badge. The saved briefing is not rewritten.
4. Select **Save changes** successfully. Saved counts become 4/2/2/0, and the existing briefing is marked out of date. Saved human wording, F05/F06 associations and the original overview stay intact. Any open editor also keeps its unsaved text.
5. The coordinator may keep the stale briefing, or continue text editing and save it with the stale flag retained. Saving wording is not regeneration.
6. If the coordinator chooses Generate, a separate preview is generated synchronously from the updated saved attendance. Generate is offered only while the briefing is not being edited and no generated preview is shown: any open edit is saved or cancelled first, and a shown preview is accepted (or the saved briefing switched to), so no typed text or unreviewed preview is caught under the result. The old saved human briefing remains available. A failed generation changes neither saved wording nor references.
7. Inspect the new preview's sources, then explicitly keep it: **Accept preview** in the read view saves it unchanged, or edit its text and Save it from its edit view. Only these actions replace the saved human briefing; the replacement is current only if attendance has not changed again.

This is the connection between the brief's **Inspect and edit** and **Keep work trustworthy** outcomes. Attendance changes trigger a warning, not an automatic rewrite or forced replacement.

## Confirmed regeneration approach

Maintain one saved briefing, one selected generated preview and one incoming candidate under [F7](07-generation-queue.md#preview-ownership-and-the-editor). Manual and automatic generations only write the incoming slot, under F7's priority rules (a manual result always wins). The coordinator explicitly selects it for editing, then explicitly saves it to replace the saved briefing. A normal Save while editing saved content persists those human text edits; an automatic job cannot perform either kind of save.

| Starting state | Generate / Regenerate behaviour | Effect on saved briefing |
| --- | --- | --- |
| No saved content or preview | Generate an incoming candidate; select it for review | Remains empty until explicit Save |
| Saved briefing, editor clean | Generate a separate incoming candidate | Existing saved text/references unchanged |
| Saved briefing being edited | Generate is not offered while the text areas are open; save or cancel first. A result arriving from elsewhere (another tab, or an automatic batch) goes to the incoming slot and **Review new preview** appears. Switching to it requires Save, explicit Discard or Cancel. | Saved and local content preserved |
| Selected preview already exists | Generate is not offered while the preview is shown: **Accept preview** saves it, or the switch shows the saved briefing, where Generate is offered. A new result (from there or from elsewhere) goes to the incoming slot; explicit selection replaces the selected preview | Saved briefing unchanged until Accept preview or Save |
| Selected preview has unsaved text; new feedback triggers a batch | Batch reads saved inputs; do not replace or lock the editor; announce the ready candidate | Selected base and local text stay saveable |
| Model or result-save failure | Keep prior selected/incoming candidates and saved briefing | Unchanged |

**Review new preview** permits changing the selected preview only, after resolving its local human edits. It does not authorise overwriting the saved briefing. There is no automatic merge between generated wording and human wording.

While generation runs, keep saved content, source inspection and the existing text editor available. Completion never changes the selected generation or typed fields. Attendance saves may continue and can make the incoming result stale. Conflicting explicit selections/saves from another tab are rejected without discarding local text.

## Race and restart behaviour

1. **Attendance changes during generation:** retain the captured input and counts. On completion, label the candidate stale and offer manual regeneration. A saved attendance change alone does not add an automatic job.
2. **Another tab saves a briefing during generation:** do not overwrite it. Generation creates only an incoming candidate. Selection and eventual replacement Save must use current saved/selected state and explicit coordinator actions.
3. **Automatic result arrives while a preview is being edited:** retain the selected server base; only incoming content changes. Another tab's explicit conflicting preview selection is different: a stale editor save is rejected and its local draft retained.
4. **Late/out-of-order UI responses:** apply responses only to the active request and baseline. Do not let an older response erase unsaved work or roll the displayed revision backward. Re-fetch on an unresolved mismatch.
5. **Refresh or backend restart:** recover saved briefing, selected/incoming previews, input baselines, freshness and job state. Interrupted model calls are not successful results; recover them under F7 (a batch interrupted before sending resumes; one interrupted after sending ends as `AI_OUTCOME_UNKNOWN`; a manual call is reported as failed or unknown) without clearing previous work.
6. **Lost response:** reload state before retrying a generation/save so an already persisted result is not needlessly replaced.
7. **Reset:** require the stopped-server reset described in [F1](01-event-and-persistence.md). Reset clears preview slots, jobs and input baselines along with the event data; reload the browser before further edits.
8. **Feedback arrives during a running generation:** the running call keeps the input it captured, and its result is labelled stale on arrival. The new note opens or joins a batch window under F7; that batch reads all notes when it runs. A manual result is never replaced by an automatic one.

These are small consistency guards for one coordinator who may refresh or open another tab. They do not require collaborative editing, an audit log or full version history.

## Acceptance criteria

| ID | Given / when | Expected result |
| --- | --- | --- |
| F6-01 | Generate and save from current saved attendance | Briefing is current and remains associated with the attendance used to generate it |
| F6-02 | Save an actual attendance change | Saved briefing and any preview based on the earlier attendance show out-of-date text |
| F6-03 | Refresh/restart after F6-02 | Out-of-date state remains; original saved human wording remains |
| F6-04 | Make unsaved attendance changes, then discard | Unsaved badge clears; persisted freshness never changed |
| F6-05 | Save unchanged attendance | Current briefing stays current |
| F6-06 (D5) | Change then revert saved attendance | Earlier briefing shows as current again because it matches the saved records; any human edits remain |
| F6-07 | Regenerate after saving human edits | Preview is separate; saved wording/references unchanged until the preview is explicitly accepted (**Accept preview**) or saved from its edit view |
| F6-08 | Regeneration fails | Previous preview and saved human work remain recoverable |
| F6-09 | Edit the briefing text; a new preview arrives from elsewhere (another tab or an automatic batch) | Generate is not offered while editing; the result is held as an incoming preview with **Review new preview**; editor text untouched; switching to it requires Save, Discard or Cancel |
| F6-10 | Attendance changes while a model call is in flight | Completed preview uses the old snapshot and is immediately labelled stale |
| F6-11 | Another tab saves before this editor saves | Revision conflict prevents silent replacement |
| F6-12 | Manually edit/save an out-of-date briefing | Edited content persists; stale flag cannot be cleared by saving |
| F6-13 | Regenerate from current attendance, then explicitly save | Replacement preserves new provenance; stale clears if attendance has not changed again |
| F6-14 | Backend restarts during generation | No fabricated completed result; previous saved briefing/preview survive |
| F6-15 | Follow the example from saved human edits through attendance change and regeneration | Human wording and fixed references survive the attendance save and generation; only an explicit **Accept preview** (or Save from the preview's edit view) replaces them |
| F6-16 | Attendance save fails while a briefing editor is dirty | Earlier saved freshness remains, the attendance draft and its Unsaved badge stay, and no human draft text is lost |
| F6-17 | Attendance changes after a new preview is returned but before it is saved | Saving preserves that preview's baseline and marks the saved replacement stale; it cannot be presented as current |
| F6-18 | A note is added (form or script) while a preview is being edited | Existing content shows “new notes since this briefing”; the batch does not overwrite the editor's base or text; its result appears only as incoming content |

## Discussion

[D1](README.md#decisions) confirms a separate preview with explicit saving to replace the saved briefing. [D9](README.md#decisions) confirms synchronous manual generation with priority, and fixed-window batching of new feedback. F7's selected/incoming distinction and priority rules preserve human work under automatic generation. [D5](README.md#decisions) confirms snapshot comparison: only a real difference is a change (a swap counts), and an exact revert matches the records again; the brief does not mandate revision tracking.
