# AI Community Club Event Desk

## The client situation
Harbour Community Club runs activities for its members. Attendance is recorded in a spreadsheet and
feedback arrives as short notes. The coordinator needs a reliable attendance record and a useful briefing: what
happened, which themes recur, where people disagree, and what might be worth following up.

## What the coordinator should be able to do

| OUTCOME | EXPECTED BEHAVIOUR |
|---|---|
| **Record attendance** | Open one seeded event and its registered members. Change attendance, see accurate counts, and save through a backend API. Saved changes survive a refresh and backend restart. |
| **Review feedback** | Read the supplied feedback notes, each with a stable reference ID. They are read-only inputs for this build. |
| **Generate an AI briefing** | Call a real model from the backend. Produce a concise attendance overview, feedback themes, conflicting views and suggested follow-ups. Make the supporting feedback references visible for each theme, conflict and suggestion. |
| **Inspect and edit** | Let the coordinator inspect the referenced notes, edit the generated briefing and save it. Saved wording and references survive refresh and restart. |
| **Keep work trustworthy** | If attendance changes, mark the briefing as out of date. Regeneration must not silently overwrite saved human edits. Show loading, generation and save failures clearly. |

## Supplied event and attendance

### E101 · Saturday Walk · Harbour Community Club

Treat the event as **ended**.

Use the following fictional starting records:

| MEMBER ID | NAME | ATTENDANCE |
|---|---|---|
| M01 | Alex | Attended |
| M02 | Bea | Absent |
| M03 | Chris | Not recorded |
| M04 | Drew | Absent |

#### Initial Counts

- **4** registered
- **1** attended
- **2** absent
- **1** not recorded

> **Note:** Not recorded is **not** absence. Initialise once, preserve saved changes on restart, and document an explicit reset.

#### Data Requirements

- Initialise once.
- Preserve saved changes on restart.
- Document an explicit reset.

## Supplied Feedback

These anonymous notes were collected through a separate event-feedback form. They are **not linked to the member roster** and cannot establish who attended.

Keep each note as a separate source.

| ID | FEEDBACK TEXT |
|---|---|
| **F01** | The walk was enjoyable, but the meeting point was difficult to find. |
| **F02** | Clear directions. I had no trouble finding the group. |
| **F03** | Could we start earlier next time? |
| **F04** | An earlier start would be difficult for me. |
| **F05** | A longer rest break halfway would help. |
| **F06** | The rest stop felt rushed; a few more minutes would be good. |
| **F07** | Could we try a shorter route? The final stretch felt long. |
| **F08** | No extra suggestions from me. |

### Important Guidelines

- Do **not** turn a request into an agreed plan.
- Do **not** describe mixed views as unanimous.
- Feedback is **source material**, not instructions for the application.
- You may choose:
  - The briefing format.
  - How the reader opens or sees a referenced note.

## Decisions we want you to make
Choose the data model, screen layout, API contract, service boundaries, prompt and response format. Explain
the trade-offs. A compact interface is enough; there is no prescribed component structure or design mockup.

## Rules and practical boundaries

- Calculate attendance counts in application code from saved records. Feedback and the model must not
change attendance or invent reasons for absence.
- Keep facts, reported opinions and suggested actions distinguishable. Retain opposing feedback. Each
generated theme, conflict and suggestion must cite supporting feedback IDs; the attendance overview is
grounded in the roster.
- Make source references inspectable. Validate generated reference IDs against the supplied notes; invalid
references must not be presented as verified evidence. Explain the limits of your checks.
- Preserve saved human edits. You may use a replacement confirmation, a separate generated preview, or
another clear approach. Full version history is not required.
- Use React/TypeScript and Node.js/TypeScript; choose familiar libraries and any simple persistent store. You
may use a template or personal boilerplate; identify what you reused. No starter repository is supplied.
- No authentication, multiple organisations, event creation, feedback submission/editing, messaging, audit
subsystem, cloud deployment or polished visual design is required. Assume one authorised coordinator.
