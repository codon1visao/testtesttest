# F6 — Freshness and safe regeneration

[All specifications](README.md) · [Source brief](../project-brief.md)

Status: **Draft for discussion.** Stale marking after attendance changes and protection of saved human edits are required. A separate generated preview is confirmed (D1, 2026-10-02). Revisions, preview persistence and the detailed interaction rules below remain proposed.

## Outcome and scope

The coordinator can tell when a briefing reflects older attendance and can generate a replacement without silently losing saved wording or local edits.

Contribution to the [client goal](README.md#product-goal-solve-the-client-situation): keep the briefing trustworthy as the attendance record is corrected. The coordinator must be able to distinguish an older account from current records and retain editorial work while deciding whether to replace it.

This feature owns shared state transitions across [attendance](02-attendance.md), [generation](04-ai-briefing-generation.md) and [editing](05-briefing-editor.md). Queue transport and explicit preview selection belong to [F7](07-generation-queue.md); no history subsystem is required.

## Freshness rule

The brief requires: **If attendance changes, mark the briefing as out of date.** It does not prescribe revision numbers, history records or a particular change-detection algorithm.

- An actual saved attendance change marks any older preview/saved briefing out of date.
- If an editor is open, update its out-of-date warning and current counts in place. Preserve its unsaved text, original source references and generation baseline. Do not automatically regenerate or replace its overview wording.
- Unsaved attendance changes do not change the persisted stale flag. Show a separate unsaved-attendance warning and block manual generation until resolved. Automatic work uses saved attendance and does not read or save browser drafts.
- Under the proposed external note-arrival path, a new persisted feedback note also makes earlier content out of date and enqueues work through F7. Show whether attendance, feedback or both changed. Existing source IDs/texts remain stable; no note-editing feature is implied.
- No-op saves do not make a current briefing stale.
- Changing members while leaving aggregate counts equal still makes the briefing stale.
- Editing or saving briefing text does not change the generation baseline.
- The brief does not specify what happens after an exact revert. D5 proposes keeping the earlier briefing stale after a saved change until regeneration; that edge-case policy remains open for discussion.
- Show the baseline counts and current saved counts so the coordinator can understand what changed. Do not replace the old overview automatically.

Use visible text such as **Out of date — attendance changed since this briefing was generated**. Keep the content readable and editable, and offer Regenerate. A stale briefing may still be saved with its warning; staleness must not cause loss of editorial work.

### Optional internal mechanism

An internal change counter or comparison with captured input can determine whether saved input changed since generation:

```text
isStale = attendanceChangedSinceGeneration || feedbackChangedSinceGeneration
```

The flags above describe input differences, not mandated database fields. A counter or comparison with the captured input can implement them. These are internal options, not coordinator tasks or attendance version history. The optional counter fields elsewhere remain unapproved. Whatever mechanism is chosen must detect changed saved attendance and, if external notes are supported, changed feedback input, including during a queued run.

## Example: edit, save, change attendance, regenerate

1. With saved seed counts 4 registered / 1 attended / 2 absent / 1 not recorded, generate a briefing preview from those saved records.
2. Inspect F05/F06, edit the text of their generated rest-break item and Save briefing. Its original references remain F05/F06, and the human wording survives refresh/restart.
3. Change Chris from Not recorded to Attended. The attendance controls immediately show unsaved counts 4/2/2/0 and an unsaved-attendance warning. The saved briefing is not rewritten.
4. Save attendance successfully. Saved counts become 4/2/2/0, and the existing briefing is marked out of date. Saved human wording, F05/F06 associations and the original overview stay intact. Any open editor also keeps its unsaved text.
5. The coordinator may keep the stale briefing, or continue text editing and save it with the stale flag retained. Saving wording is not regeneration.
6. If the coordinator chooses Regenerate, resolve unsaved text first and generate a separate preview from the updated saved attendance. The old saved human briefing remains available. A failed generation changes neither saved wording nor references.
7. Inspect the new preview's sources, optionally edit its text, then explicitly Save and replace briefing. Only this action replaces the saved human briefing; the replacement is current only if attendance has not changed again.

This is the connection between the brief's **Inspect and edit** and **Keep work trustworthy** outcomes. Attendance changes trigger a warning, not an automatic rewrite or forced replacement.

## Confirmed regeneration approach

Maintain one saved briefing, one selected generated preview and one incoming candidate under [F7](07-generation-queue.md#preview-ownership-and-the-editor). A worker only writes the incoming slot. The coordinator explicitly selects it for editing, then explicitly saves it to replace the saved briefing. A normal Save while editing saved content persists those human text edits; an automatic job cannot perform either kind of save.

| Starting state | Generate / Regenerate behaviour | Effect on saved briefing |
| --- | --- | --- |
| No saved content or preview | Generate an incoming candidate; select it for review | Remains empty until explicit Save |
| Saved briefing, editor clean | Generate a separate incoming candidate | Existing saved text/references unchanged |
| Saved briefing with unsaved edits; manual Regenerate | Explain Save or explicitly Discard first; Cancel preserves the editor | Saved and local content preserved until chosen action |
| Selected preview already exists | New result goes to incoming slot; explicit selection replaces the selected preview | Saved briefing unchanged |
| Selected preview has unsaved text; automatic trigger arrives | Queue from saved inputs; do not replace or lock the editor; announce ready candidate | Selected base and local text stay saveable |
| Model or result-save failure | Keep prior selected/incoming candidates and saved briefing | Unchanged |

**Review new preview** permits changing the selected preview only, after resolving its local human edits. It does not authorise overwriting the saved briefing. There is no automatic merge between generated wording and human wording.

While generation runs, keep saved content, source inspection and the existing text editor available. Completion never changes the selected generation or typed fields. Attendance saves may continue and can make the incoming result stale. Conflicting explicit selections/saves from another tab are rejected without discarding local text.

## Race and restart behaviour

1. **Attendance changes during generation:** retain the captured input and counts. On completion, label the candidate stale and offer manual regeneration. A saved attendance change alone does not add an automatic job.
2. **Another tab saves a briefing during generation:** do not overwrite it. Generation creates only an incoming candidate. Selection and eventual replacement Save must use current saved/selected state and explicit coordinator actions.
3. **Automatic result arrives while a preview is being edited:** retain the selected server base; only incoming content changes. Another tab's explicit conflicting preview selection is different: a stale editor save is rejected and its local draft retained.
4. **Late/out-of-order UI responses:** apply responses only to the active request and baseline. Do not let an older response erase unsaved work or roll the displayed revision backward. Re-fetch on an unresolved mismatch.
5. **Refresh or backend restart:** recover saved briefing, selected/incoming previews, input baselines, freshness and job state. Interrupted model calls are not successful results; recover them under F7's bounded retry policy without clearing previous work.
6. **Lost response:** reload state before retrying a generation/save so an already persisted result is not needlessly replaced.
7. **Reset:** require the stopped-server reset described in [F1](01-event-and-persistence.md). Reset clears preview slots, jobs and input baselines along with the event data; reload the browser before further edits.
8. **Feedback arrives during a running job:** mark the older baseline stale and collect requests under F7's fixed-window rule. Keep each closed window's winner in FIFO order; later windows do not replace earlier winners. Never mutate a sealed/running snapshot or let its completion remove other pending work. A winner can already be stale before its model call starts.

These are small consistency guards for one coordinator who may refresh or open another tab. They do not require collaborative editing, an audit log or full version history.

## Acceptance criteria

| ID | Given / when | Expected result |
| --- | --- | --- |
| F6-01 | Generate and save from current saved attendance | Briefing is current and remains associated with the attendance used to generate it |
| F6-02 | Save an actual attendance change | Saved briefing and any preview based on the earlier attendance show out-of-date text |
| F6-03 | Refresh/restart after F6-02 | Out-of-date state remains; original saved human wording remains |
| F6-04 | Make unsaved attendance changes, then discard | Unsaved warning clears; persisted freshness never changed |
| F6-05 | Save unchanged attendance | Current briefing stays current |
| F6-06 (proposed D5 policy) | Change then revert saved attendance | Earlier briefing remains stale; exact-revert behaviour is not specified by the brief |
| F6-07 | Regenerate after saving human edits | Preview is separate; saved wording/references unchanged until explicit replacement Save |
| F6-08 | Regeneration fails | Previous preview and saved human work remain recoverable |
| F6-09 | Attempt manual regeneration with unsaved human edits | Save/Discard resolution required; cancelling loses nothing; automatic work instead preserves the active editor |
| F6-10 | Attendance changes while a model call is in flight | Completed preview uses the old snapshot and is immediately labelled stale |
| F6-11 | Another tab saves before this editor saves | Revision conflict prevents silent replacement |
| F6-12 | Manually edit/save an out-of-date briefing | Edited content persists; stale flag cannot be cleared by saving |
| F6-13 | Regenerate from current attendance, then explicitly save | Replacement preserves new provenance; stale clears if attendance has not changed again |
| F6-14 | Backend restarts during generation | No fabricated completed result; previous saved briefing/preview survive |
| F6-15 | Follow the example from saved human edits through attendance change and regeneration | Human wording and fixed references survive the attendance save and generation; only explicit replacement Save replaces them |
| F6-16 | Attendance save fails while a briefing editor is dirty | Earlier saved freshness remains, unsaved-attendance warning stays, and no human draft text is lost |
| F6-17 | Attendance changes after a new preview is returned but before it is saved | Saving preserves that preview's baseline and marks the saved replacement stale; it cannot be presented as current |
| F6-18 | A supported upstream note arrives while a preview is being edited | Existing content becomes stale; background work does not overwrite its base or text; new result appears only as incoming content |

## Discussion

[D1](README.md#decisions-to-resolve-together) confirms a separate preview with explicit saving to replace the saved briefing. [D9](README.md#decisions-to-resolve-together) confirms ordered generation with a configurable fixed window selecting the latest request. F7's selected/incoming distinction and implementation details remain proposals for preserving human work under automatic generation. [D5](README.md#decisions-to-resolve-together) leaves exact-revert freshness open; the brief does not mandate revision tracking.
