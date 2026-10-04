# Event dashboard — design

Status: **Design approved by the user on 2026-10-04.** UI restructure of the coordinator event page;
it amends F2, F3 and F5 (section 6) and changes no data, mutation, API, freshness, conflict or focus
logic.

## 1. Intent

The event page already shows the right data. The coordinator should be able to track and operate it
at a glance: a dashboard with the briefing first, tables for attendance and feedback, and a briefing
that reads as a summary before it is edited.

What the user asked for:

- A dashboard UI in its own layout, using tables.
- Astryx components for consistency, e.g. a dropdown instead of the native select.
- Attendance as a table with two columns, **Name** and **Actions**.
- Briefing first, with **Generate briefing** on the right of the section header. The feedback summary
  comes first and is highlighted. Themes and disagreements are lists in a two-column layout; clicking a
  row expands it to show its sources. Follow-ups are a list below the two columns.
- No logic changes; the briefing stays editable. A **Cancel edit** button sits next to the save button.

Decisions taken with the user: a read view with an explicit **Edit briefing** (not always-editable
fields), and a shell with a main/side grid (not stacked sections or side navigation).

Success: every flow and acceptance criterion of F2–F7 still holds; the briefing is the first thing on
the page; attendance and feedback are scannable tables; `pnpm verify` and `pnpm e2e` pass.

## 2. Layout

- `EventDashboardLayout` (`apps/web/src/features/event/event-dashboard-layout.tsx`) wraps Astryx
  `AppShell` with a `TopNav`: event name, club name, the **Ended** badge and a live/offline indicator
  from the existing `useEventChanges(eventId).live`.
- Content is a two-column grid: **main** (about two thirds) holds Briefing; **side** (about one third)
  holds Attendance above Feedback. Below roughly 900px it is one column: Briefing, Attendance, Feedback.
- The refetch-error banner sits above the grid. Loading and load-error states render inside the
  same shell. The not-found page and the feedback form page keep their current layouts. The shell
  provides the page's `main` landmark, so the event screen no longer renders its own `<main>`.
- Each panel keeps its `PanelErrorBoundary` and its `section` landmark with an accessible name.

## 3. Briefing (main column)

### Header and status

- Header row: heading **Briefing** on the left, the Generate button on the right.
- Directly below: the generation status line, batch status, generation error banner, the incoming
  preview notice and the "changes were saved" banner — the same components and conditions as today.
  `GenerateBriefingControl` is split so its button can sit in the header while its status output stays
  below; its state and handlers are unchanged.

### Briefing meta

Title (Generated preview — not saved as briefing / Saved briefing · last saved …), provenance line,
the Generated preview / Saved briefing switcher, the freshness notice and the evidence-limit notice.

### Read view (default)

- **Summary card**, highlighted: the feedback summary in prominent text, the attendance overview
  below it as supporting text, and a **Sources (n)** disclosure for the summary's cited notes.
- **Two columns:** "Which themes recur" | "Where people disagree". Each is a list of rows: item text
  plus its cited IDs as small badges. Activating a row toggles a panel listing every cited note
  (ID badge + plain text). Empty sections show their existing empty copy.
- **Follow-ups:** "What might be worth following up", a full-width list below with the same rows.
- **Actions:** **Edit briefing**. For a selected generated preview, **Save briefing** (or **Save and
  replace briefing** when a saved briefing exists) is also offered here: saving a preview does not
  require editing it.
- Save notices and the "Latest saved briefing" comparison render here too, because a save can start
  from the read view.

### Edit view

- Same arrangement with labelled text areas: summary (and attendance overview with its counts note)
  first, theme and disagreement text areas in two columns, follow-ups below. Each item keeps its
  **Sources (n)** disclosure so sources stay inspectable while typing (F5-05).
- Actions: **Save briefing** / **Save and replace briefing** and **Cancel edit**, side by side.
- **Cancel edit** with unsaved changes opens the existing "Discard your edits?" confirmation; confirm
  discards and returns to the read view, cancel keeps editing. Without unsaved changes it returns to the
  read view immediately. It replaces **Discard edits**.
- The edit/read mode is local state of `BriefingEditor`. A successful save remounts the editor (its
  key changes, as today), so it returns to the read view. A clean editor that remounts because the view
  moved on also returns to the read view; a dirty draft never remounts, so typed text is never replaced
  without an explicit choice (unchanged rule).
- Entering edit mode moves focus to the first text area; leaving it moves focus to the editor heading,
  so focus never falls to `<body>`.

### Source disclosure

`SourceReferences` becomes one disclosure per item: a trigger with `aria-expanded` and `aria-controls`
revealing all of the item's cited notes. Open state stays in the UI store's `openSources`, now keyed
`${disclosureScope}` (the item) instead of `${disclosureScope}:${feedbackId}`. A cited ID that is not
among the event's notes still shows the "Source … is unavailable" error badge.

## 4. Attendance (side column)

- Count line at the top: saved counts; unsaved counts as well when there are changes (existing
  `AttendanceCounts`, `aria-live` kept).
- Astryx `Table` with columns **Name** and **Actions**. Actions holds an Astryx `Selector`
  (Attended / Absent / Not recorded) whose accessible name includes the member name, bound to
  react-hook-form through `Controller` and disabled while busy.
- Below the table: unsaved warning, notices, **Save attendance** and **Discard attendance changes**,
  the reload confirmation — unchanged.

## 5. Feedback (side column)

- Header: heading **Feedback** with the "Open feedback form (test)" link on the right, and the
  existing note-count and anonymity line below it.
- Astryx `Table` with columns **ID** and **Note**, stable ID order. The **New since this briefing**
  badge sits in the ID cell. Note text is plain text and wraps.

## 6. Spec amendments (2026-10-04, user-approved)

- **F2:** "a labelled native select for each member" becomes "a labelled Astryx Selector for each
  member, in a Name/Actions table".
- **F3:** per-note **Read source F01** toggles become one disclosure per briefing item that reveals all
  of its cited notes, with `aria-expanded` and a relationship to the revealed notes; the cited IDs stay
  visible next to the item's text.
- **F5:** the briefing opens in a read view with an explicit **Edit briefing**; **Cancel edit**
  replaces **Discard edits** and asks before losing unsaved changes; a selected preview can be saved
  from the read view.
- The spec index (`docs/specs/README.md`) status lines and the README's screen description follow.

## 7. Out of scope

No changes to contracts, event-api, ai-gateway, data fetching, mutations, caches, the UI store's
other fields, live updates or generation rules. No new dependencies.

## 8. Testing

- Update existing RTL tests for the new controls: attendance panel (Selector), briefing editor and
  panel (enter edit mode, Cancel edit), feedback panel (table), source reference (per-item disclosure),
  event page and live updates.
- New tests: Cancel edit when clean; Cancel edit when dirty, both confirm and cancel paths; save
  returns to the read view; saving a preview from the read view; row expand/collapse shows the cited
  notes; the summary renders before the lists; the layout renders the header and three panels.
- Update both e2e specs. F6 walkthrough: `selectOption` becomes opening the Selector and choosing an
  option; press **Edit briefing** before filling text areas; **Read source F05/F06** becomes the
  theme row's sources disclosure; checks of saved wording read the read-view text. F7: after
  **Review new preview**, assert the theme text in the read view instead of a text area value.
- Browser check at desktop and mobile widths; `pnpm verify`, then `pnpm e2e`.
