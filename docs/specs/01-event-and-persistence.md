# F1 — Event, initial data and persistence

[All specifications](README.md) · [Source brief](../project-brief.md)

Status: **Confirmed by the user on 2026-10-03.** Seed values and durability requirements come from the brief. Persistence uses MySQL through TypeORM, with the tables, relations and transactions defined in [T4](13-data-model-and-transactions.md).

## Outcome and scope

The coordinator can open the supplied ended event and see a trustworthy persisted starting point. Attendance, saved briefing wording and saved references survive refresh and backend restart.

Contribution to the [client goal](README.md#product-goal-solve-the-client-situation): the coordinator can return to a dependable record and reviewed briefing without reconstructing previously saved work.

This feature owns initialisation, event loading, durable writes and reset documentation. Attendance mutations belong to [F2](02-attendance.md); briefing generation and editing belong to [F4](04-ai-briefing-generation.md) and [F5](05-briefing-editor.md).

## Initial records

| Field | Value |
| --- | --- |
| Event ID | `E101` |
| Event name | Saturday Walk |
| Club | Harbour Community Club |
| Status | Ended, regardless of the machine's current date |

| Member ID | Name | Stored attendance | Display label |
| --- | --- | --- | --- |
| `M01` | Alex | `attended` | Attended |
| `M02` | Bea | `absent` | Absent |
| `M03` | Chris | `not_recorded` | Not recorded |
| `M04` | Drew | `absent` | Absent |

Initial counts are 4 registered, 1 attended, 2 absent and 1 not recorded. Seed the eight exact feedback notes defined in [F3](03-feedback-and-sources.md#supplied-sources). Initially there is no saved briefing or generated preview. Initialise `attendanceRevision` and `briefingRevision` to 0.

## Required behaviour

1. If persistent application data does not exist, initialise the complete event, roster and feedback exactly once.
2. If valid data exists, load it without resetting attendance, briefing text, source references or provenance.
3. A normal server restart, browser refresh or failed API call must never invoke reset.
4. Calculate response counts from persisted member states. Do not store an independently mutable totals record.
5. Each write is all-or-nothing. Do not acknowledge success or update authoritative in-memory state until persistence succeeds.
6. If existing data is unreadable, incomplete or invalid, fail clearly and preserve it for recovery. Do not silently replace it with seed data.
7. Persist enough information about the briefing's attendance baseline and out-of-date state that a restart does not make stale content appear current. The brief does not prescribe revision fields to achieve this.

## API and loading flow

`GET /api/events/E101` returns event, members, feedback, derived counts, revision counters, saved briefing, selected generated preview, incoming preview and generation job status under [F7](07-generation-queue.md). Each briefing includes backend-computed freshness. Return `null` for missing briefings rather than fabricated content. Persist job/input/result state consistently with event data so recovery cannot lose pending work or the selected editor base. The response is served through the Redis event-view cache, which every write flushes ([T3 §7](12-architecture-and-repository.md#7-response-cache-a4)); the cache never replaces MySQL as the source of truth.

On initial load, show a loading state without presenting empty or zero attendance as fact. On success, populate all panels from the response. On failure, show an understandable error and Retry. After a later refresh failure, an already displayed snapshot may remain visible with a warning that it could not be refreshed.

Unknown event IDs return `404`. There is no event creation, member editing or feedback write endpoint.

## Persistence and reset

Use MySQL through TypeORM repositories under [T2](11-backend-technologies.md); tables, relations and transaction boundaries are in [T4](13-data-model-and-transactions.md). Run every write as one InnoDB transaction that first locks the event row (`SELECT … FOR UPDATE`), checks the relevant revision and then applies only the changed rows; never rewrite unrelated data from an outdated whole-event snapshot. Schema changes are versioned migrations (`synchronize` disabled). Validate loaded rows and JSON columns with the shared Zod schemas. A database connection/read failure is not an empty database and must never trigger reseeding.

Structural invalidity (unparseable rows/JSON, unknown enum values, missing event) fails clearly as `STORE_CORRUPT`. A stored briefing reference that no longer matches a feedback note is reported per item and blocks Save under [F3](03-feedback-and-sources.md) and [F5](05-briefing-editor.md); it does not prevent the event from loading.

The explicit reset is a local developer operation, not a button or public HTTP endpoint:

1. Stop the event backend/worker and AI Gateway so no application save or returned generation can race with reset. Cancelling an already submitted provider request does not guarantee it was not processed.
2. Run the dedicated reset command against the documented application MySQL database and the application's Redis key prefixes (queue and cache); state clearly that it removes saved attendance, briefings, selected/incoming previews, jobs and retained generation snapshots. Never drop unrelated databases or run `FLUSHALL`. The command refuses to run while the event API health check answers.
3. Start the Gateway and event backend, then verify that the supplied seed is restored with no old job/result carried over.

The implementation must document the actual command, target database/collections and application cache/queue namespaces before delivery, without exposing connection secrets. Do not advertise a command that does not exist yet. Normal startup and setup commands must not delete saved work. Any backup before reset is an operator choice; no backup subsystem is required.

## Acceptance criteria

| ID | Given / when | Expected result |
| --- | --- | --- |
| F1-01 | First start with no store | E101, four exact members, eight exact notes and counts 4/1/2/1; no briefing |
| F1-02 | Change and save attendance, refresh, then restart backend | Saved member values and recomputed counts remain |
| F1-03 | Save human text edits with the unchanged generated references, then refresh/restart | Exact saved wording, reference associations, attendance baseline and out-of-date state remain |
| F1-04 | Start repeatedly against an existing store | No duplicate event, member or note; no seed overwrite |
| F1-05 | Store is malformed or unwritable | Clear failure; no false successful save or automatic reseed |
| F1-06 | A write fails before its atomic update/transaction commits | Previously saved state remains readable after restart; no partial update |
| F1-07 | Run the documented reset while the event backend and Gateway are stopped | Seed restored and all saved briefings, previews, jobs and generation snapshots removed |
| F1-08 | Request unknown event or fail initial load | Explicit not-found/error UI with retry where appropriate; no invented data |

## Discussion

[D3 in the index](README.md#decisions) confirms MySQL through TypeORM (2026-10-03). The table layout and transaction strategy must satisfy the same durability, conflict and reset requirements; InnoDB's default `innodb_flush_log_at_trx_commit=1` provides durable commits. Redis response caching does not replace durable storage.
