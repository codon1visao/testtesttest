# F2 — Attendance recording and counts

[All specifications](README.md) · [Source brief](../project-brief.md)

Status: **Confirmed by the user on 2026-10-03.** Amended 2026-10-04 (user-approved): a retry after a lost response keeps the draft's base revision. Amended 2026-10-04 (user-approved): attendance is a Name/Actions table with an Astryx Selector per member. Amended 2026-10-04 (user-approved): the counts are four stat tiles; unsaved changes show "saved → draft" on the changed tiles with an "Unsaved" badge (superseded below). Amended 2026-10-04 (user-approved): attendance saves on each change; tiles in one row. Three-state attendance, application-calculated counts, backend persistence, a full-roster save on each change and revision-based conflict checks.

## Outcome and scope

The coordinator updates the four registered members and sees accurate totals; each change is saved as soon as it is made. Attendance is established only by these records, never by feedback or AI inference.

Contribution to the [client goal](README.md#product-goal-solve-the-client-situation): establish the reliable factual record behind the briefing's account of what happened, including what remains unrecorded.

“Record attendance” means update and save each member's current attendance status. It does not mean create an attendance revision, history entry or audit record. The `attendanceRevision` field below is a confirmed internal concurrency token for conflicting saves, not functionality requested by the brief.

## Coordinator flow

1. Open E101 and read the saved attendance and counts from [F1](01-event-and-persistence.md).
2. Choose a status (Attended, Absent or Not recorded) in a member's control. Choosing the status the member already has does nothing.
3. The choice is saved at once: one request with all four members (the saved statuses with this member's new one) and the saved revision on screen. While it is in flight, every member control is locked, a **Saving…** badge shows above the counts, the counts show the chosen statuses, and manual generation waits.
4. On success, adopt the response as the saved records and update briefing freshness using [F6](06-freshness-and-regeneration.md); an "Attendance saved" toast confirms it.
5. On failure, revert the control to the saved status and show an error naming the member ("Chris was not saved") with the reason. The next successful save clears it.

Show the counts as a stat strip: four equal cells in one row — **Registered**, **Attended**, **Absent** and **Not recorded** — separated by thin dividers, each with its value centred above its label. Labels never break inside a word. They count the statuses the controls show, which equal the saved records except while a save is in flight.

Show the members in a table with **Name** and **Actions** columns; each Actions cell is a labelled Astryx Selector (Attended / Absent / Not recorded). The accessible name includes the member name. After a choice, keyboard focus stays on that member's control: it is locked through `aria-disabled` while the save is in flight, so focus never falls to the page. A save never changes another panel's work as a side effect.

If a generated or saved briefing already exists, a successful attendance change marks it out of date. If its editor is open, update the warning and current saved counts in place while preserving every unsaved text edit and fixed reference. Do not replace editor content with a refetched server copy or trigger generation automatically. A failed attendance save keeps the earlier saved records.

## Rules and counts

- Allowed stored values are exactly `attended`, `absent`, `not_recorded`.
- Not recorded is its own category. Never coerce it to Absent, including in labels, exports to the model or counts.
- `registered = members.length`; each other count is the number of records with that exact state.
- Always satisfy `registered = attended + absent + notRecorded`.
- Do not infer reasons for absence or decide attendance from feedback.
- Only attendance is editable. Member IDs/names and roster size are fixed for this build.
- A successful save that changes any member status makes an existing briefing out of date. An unchanged or failed save does not create a new attendance change.
- Swapping two members' statuses is a real change even if aggregate counts are identical.
- Manual generation is unavailable while an attendance save (or the re-read that decides its outcome) is in flight, and while that outcome is unknown. Explain that attendance must finish saving first ("Wait for attendance to save before generating."). Automatic note-triggered jobs in [F7](07-generation-queue.md) use saved attendance.

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
| Saved | Saved statuses and counts; every control available. A newer saved view (another tab, live update) replaces what is shown whenever no save is in flight |
| Saving | **Saving…** badge; all controls locked (a second change cannot start); counts show the chosen statuses; manual generation blocked with explanation; background work uses saved values |
| Save failed | Revert to the saved status; error banner "{Name} was not saved" with the reason |
| Revision conflict | Re-read the saved records and show them; warning "Attendance changed elsewhere": "Your change to {Name} was not applied. The latest saved attendance is shown." If the re-read fails, show the last known saved records and the reason |

A lost response is ambiguous: the backend may already have persisted the save. Fetch current data once to compare: if the saved records match the submitted statuses, report "{Name} was saved."; otherwise show the latest saved records with the warning "Could not confirm the save" ("Your change to {Name} was not applied. The latest saved attendance is shown."). If that re-read fails, warn "Could not check the saved attendance" with the reason and a **Check again** action; the controls stay locked and manual generation stays blocked until a check succeeds. A save always carries the saved revision on screen, so a change saved elsewhere meanwhile surfaces as a revision conflict instead of being overwritten. Do not automatically replay an old full roster over newer values. Warn on page exit while a save is in flight or its outcome is unknown, where the browser supports it.

## Acceptance criteria

| ID | Given / when | Expected result |
| --- | --- | --- |
| F2-01 | Initial records load | Counts are 4 registered, 1 attended, 2 absent, 1 not recorded |
| F2-02 | Change Chris to Attended | One save with all four members and the saved revision is sent at once; while it is in flight the controls are locked, "Saving…" shows and the tiles read 4/2/2/0 |
| F2-03 | After that save, refresh/restart | Chris remains Attended; totals 4/2/2/0; any existing briefing reflects the out-of-date state |
| F2-04 | Set all members to Not recorded and save | Totals 4/0/0/4; no implied absence |
| F2-05 | Submit unknown state, duplicate/missing member or client totals | Request rejected; persisted records unchanged |
| F2-06 | Save unchanged data (API), or choose a member's current status (UI) | Saved values/counts unchanged; no new stale flag; the UI sends nothing |
| F2-07 | Swap Alex and Bea statuses and save | Counts may stay equal, but member statuses change and the older briefing becomes stale |
| F2-08 | Save fails | No partial overwrite; the control reverts to the saved status and "{Name} was not saved" explains why |
| F2-09 | A change is saving while a saved briefing exists | Briefing's persisted freshness changes only once the save succeeds; Generate waits meanwhile |
| F2-10 | Use keyboard only | Every member selector can be identified and operated; focus stays on it through the save |
| F2-11 | Save changed attendance while a briefing has unsaved text edits | Counts update and the editor becomes out of date; all typed text and original reference associations remain; no automatic regeneration |

## Dependencies and discussion

Depends on [F1](01-event-and-persistence.md); triggers [F6](06-freshness-and-regeneration.md). Each change saves at once (user decision 2026-10-04, replacing explicit batch Save): what the controls show is the durable baseline except while a save is in flight, so there is no unsaved draft to save, discard or lose. A failure reverts with an error; a conflict reloads the saved records; a lost response is re-read once; Generate waits while a save is in flight. The API contract is unchanged: each save still sends the full roster with its base revision.
