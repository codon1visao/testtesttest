# F2 — Attendance recording and counts

[All specifications](README.md) · [Source brief](../project-brief.md)

Status: **Confirmed by the user on 2026-10-03.** Amended 2026-10-04 (user-approved): a retry after a lost response keeps the draft's base revision. Amended 2026-10-04 (user-approved): attendance is a Name/Actions table with an Astryx Selector per member. Amended 2026-10-04 (user-approved): the counts are four stat tiles; unsaved changes show "saved → draft" on the changed tiles with an "Unsaved" badge. Three-state attendance, application-calculated counts, backend persistence, explicit batch saving and revision-based conflict checks.

## Outcome and scope

The coordinator updates the four registered members, sees accurate totals and deliberately saves the changes. Attendance is established only by these records, never by feedback or AI inference.

Contribution to the [client goal](README.md#product-goal-solve-the-client-situation): establish the reliable factual record behind the briefing's account of what happened, including what remains unrecorded.

“Record attendance” means update and save each member's current attendance status. It does not mean create an attendance revision, history entry or audit record. The `attendanceRevision` field below is a confirmed internal concurrency token for conflicting saves, not functionality requested by the brief.

## Coordinator flow

1. Open E101 and read the saved attendance and counts from [F1](01-event-and-persistence.md).
2. Change one or more member controls among Attended, Absent and Not recorded.
3. See counts recalculate immediately from the current selections, labelled as unsaved. Keep the saved totals distinguishable as the generation baseline.

Show the counts as four stat tiles — **Registered**, **Attended**, **Absent** and **Not recorded** — each with its value above its label. With unsaved changes, an **Unsaved** badge appears above the tiles, and each tile whose draft value differs from the saved value shows `saved → draft` (for example `1 → 2`); unchanged tiles show the plain value.
4. Select **Save attendance** to persist all selections in one request.
5. On success, replace the saved baseline with the response, clear the dirty state and update briefing freshness using [F6](06-freshness-and-regeneration.md).
6. On failure, retain selections, show the failure and allow a deliberate retry.

Show the members in a table with **Name** and **Actions** columns; each Actions cell is a labelled Astryx Selector (Attended / Absent / Not recorded). The accessible name includes the member name. Show an explicit **Discard attendance changes** action that restores the last confirmed saved values. Do not autosave or discard another panel's changes as a side effect.

If a generated or saved briefing already exists, a successful attendance change marks it out of date. If its editor is open, update the warning and current saved counts in place while preserving every unsaved text edit and fixed reference. Do not replace editor content with a refetched server copy or trigger generation automatically. A failed attendance save keeps the earlier saved baseline; the unsaved-attendance warning remains.

## Rules and counts

- Allowed stored values are exactly `attended`, `absent`, `not_recorded`.
- Not recorded is its own category. Never coerce it to Absent, including in labels, exports to the model or counts.
- `registered = members.length`; each other count is the number of records with that exact state.
- Always satisfy `registered = attended + absent + notRecorded`.
- Do not infer reasons for absence or decide attendance from feedback.
- Only attendance is editable. Member IDs/names and roster size are fixed for this build.
- A successful save that changes any member status makes an existing briefing out of date. An unchanged or failed save does not create a new attendance change.
- Swapping two members' statuses is a real change even if aggregate counts are identical.
- Manual generation is unavailable while attendance has unsaved changes. Explain that attendance must be saved or discarded first. Automatic note-triggered jobs in [F7](07-generation-queue.md) use saved attendance and preserve any local draft.

## API contract

`attendanceRevision` advances once per successful save with an actual status change; no-op saves leave it unchanged. It detects conflicting saves only; freshness is computed by comparing each briefing's stored attendance snapshot with current saved statuses ([F6](06-freshness-and-regeneration.md)).

`PUT /api/events/E101/attendance`

```json
{
  "baseAttendanceRevision": 0,
  "members": [
    { "id": "M01", "attendance": "attended" },
    { "id": "M02", "attendance": "absent" },
    { "id": "M03", "attendance": "attended" },
    { "id": "M04", "attendance": "absent" }
  ]
}
```

The backend requires each registered member exactly once, a recognised state and a nonnegative integer baseline revision. Reject missing, duplicate or unknown members, unknown fields and invalid states without a partial write. Compare the baseline revision to current persisted state within the serialized write; reject a mismatch with `409 ATTENDANCE_CONFLICT`.

On success, return persisted members, derived counts, the revision and current saved/preview freshness. The example produces 4 registered, 2 attended, 2 absent and 0 not recorded. Counts supplied by a client are not accepted as authority.

## States and failure handling

| State | User-visible behaviour |
| --- | --- |
| Loading | Labelled loading state; editing unavailable until saved records load |
| Saved | Saved totals and current selections; save inactive until dirty |
| Dirty | Unsaved marker; Save and Discard available; manual generation blocked with explanation; background work uses saved values |
| Saving | Prevent duplicate submission and lock attendance inputs until this save resolves |
| Save failed | Keep dirty selections and previous saved totals; show error and Retry |
| Revision conflict | Preserve local selections; explain that saved attendance changed and offer reload after confirming draft discard |

A lost response is ambiguous: the backend may already have persisted the save. Fetch current data once to compare: if the saved records match the draft, report it saved; otherwise keep the draft. A retry keeps the draft's base revision, so a change saved elsewhere meanwhile surfaces as a revision conflict instead of being overwritten. Do not automatically replay an old full roster over newer values. Warn on page exit while dirty where the browser supports it; unsaved selections are not guaranteed to survive refresh.

## Acceptance criteria

| ID | Given / when | Expected result |
| --- | --- | --- |
| F2-01 | Initial records load | Counts are 4 registered, 1 attended, 2 absent, 1 not recorded |
| F2-02 | Change Chris to Attended before save | Counts immediately preview 4/2/2/0 with an unsaved label; saved baseline remains 4/1/2/1 (tiles: Attended `1 → 2`, Not recorded `1 → 0`, "Unsaved" badge) |
| F2-03 | Save that change and refresh/restart | Chris remains Attended; totals 4/2/2/0; any existing briefing reflects the out-of-date state |
| F2-04 | Set all members to Not recorded and save | Totals 4/0/0/4; no implied absence |
| F2-05 | Submit unknown state, duplicate/missing member or client totals | Request rejected; persisted records unchanged |
| F2-06 | Save unchanged data | Saved values/counts unchanged; no new stale flag |
| F2-07 | Swap Alex and Bea statuses and save | Counts may stay equal, but member statuses change and the older briefing becomes stale |
| F2-08 | Save fails | No partial overwrite; local edits retained and failure explained |
| F2-09 | Change selections while a saved briefing exists, without saving | Briefing's persisted freshness is unchanged; unsaved attendance warning appears |
| F2-10 | Use keyboard only | Every member selector, Save and Discard can be identified and operated |
| F2-11 | Save changed attendance while a briefing has unsaved text edits | Counts update and the editor becomes out of date; all typed text and original reference associations remain; no automatic regeneration |

## Dependencies and discussion

Depends on [F1](01-event-and-persistence.md); triggers [F6](06-freshness-and-regeneration.md). Explicit batch Save is the chosen behaviour because it makes the durable attendance baseline visible before generation. Automatic saving would need a different dirty-state and generation contract.
