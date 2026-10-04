# Event Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the coordinator event page into a dashboard — an Astryx app shell with the briefing
first in a wide main column, and attendance and feedback as tables in a side column — with a
read-first briefing (highlighted summary, two-column themes/disagreements with expandable source
rows, follow-ups below) and an explicit Edit briefing / Cancel edit flow. No data, API, mutation,
cache, freshness, conflict or focus-rule changes.

**Architecture:** Pure presentation work in `apps/web`. A per-item `SourceDisclosure` (Astryx
`Collapsible`, open state in the existing UI store) replaces per-note toggles. A shared
`BriefingSectionsLayout` arranges both the read view (`BriefingContentView`) and the edit view, so
they cannot drift. The Generate control's state moves into a `useGenerateControl` hook so its button
can sit in the section header. `BriefingEditor` gains local read/edit state; a remount (after save,
or a clean editor following the view) returns to the read view. `EventDashboardLayout` wraps
`AppShell` + `TopNav`; a CSS grid places the panels.

**Tech Stack:** React 19, TypeScript strict, Astryx `@astryxdesign/core` 0.6.5 (`AppShell`,
`TopNav`, `Table`, `Selector`, `Collapsible`, `Card`, `Grid`, `Badge`), StyleX 0.19, React Hook
Form 7, Zustand 5, Vitest + Testing Library + MSW, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-event-dashboard-design.md` (approved 2026-10-04).
Read it before starting; it amends F2, F3 and F5.

## Global Constraints

- No new dependencies. Everything used here ships in `@astryxdesign/core` 0.6.5, already installed.
- TypeScript strict; no `any`, no non-null assertions (`!`), no string throws; exhaustive `switch`
  with `assertNever`.
- Kebab-case file names. Multiple related components may share a file.
- Feedback and model text is untrusted: render it as React text only, never as HTML or Markdown.
- No changes to `packages/contracts`, `apps/event-api`, `apps/ai-gateway`, data fetching,
  mutations, caches, live updates or generation rules.
- Exact copy: **Edit briefing**, **Cancel edit**, **Save briefing**, **Save and replace briefing**,
  **Sources (n)** (n = number of available cited notes), table headers **Name** / **Actions** and
  **ID** / **Note**, table labels **Member attendance** and **Feedback notes**, live status
  **Live updates** / **Polling for updates**.
- Before every commit: `pnpm format` (Prettier writes the touched files), then `pnpm verify`. Conventional commit subjects (`feat(web): …`,
  `docs: …`, `test(e2e): …`). End every commit message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work on branch `feat/event-dashboard` (already created; the spec is committed there).

## Review Focus

1. A server field error on a save started from the read view (a selected preview saved without
   editing): the editor must open its text areas and focus the failing field, not leave the error on
   a hidden field. Pinned in Task 6.
2. Cancel edit after that error, with nothing typed: the fields close and stay closed (the error is
   cleared, so the read view does not bounce back to edit). Pinned in Task 6.
3. A clean, open editor when another tab saves a newer revision: it returns to the read view and
   nothing is lost; a dirty draft is never replaced (existing conflict tests). Pinned in Task 6.
4. A cited ID that is not among the event's notes: the "Source … is unavailable" error shows without
   opening anything, and the row's wording still shows when no cited note is available. Pinned in
   Task 1.
5. Long unbroken note or item text in the narrow side column and in briefing rows: it wraps, and the
   page never scrolls horizontally at 375 px. Pinned by the browser check in Task 7.

---

### Task 1: Per-item source disclosure

Replace the per-note "Read source F05" toggles with one disclosure per item that reveals every cited
note (spec §3 "Source disclosure", F3 amendment).

**Files:**
- Rename: `apps/web/src/features/feedback/source-reference.tsx` → `apps/web/src/features/feedback/source-disclosure.tsx`
- Rename: `apps/web/src/features/feedback/source-reference.test.tsx` → `apps/web/src/features/feedback/source-disclosure.test.tsx`
- Modify: `apps/web/src/state/ui-store.ts`
- Modify: `apps/web/src/features/briefing/briefing-preview.tsx` (import + component name)
- Modify: `apps/web/src/features/briefing/briefing-editor.tsx` (import + component name)
- Modify tests: `apps/web/src/features/briefing/briefing-editor.test.tsx`, `apps/web/src/features/briefing/briefing-panel.test.tsx`

**Interfaces:**
- Produces: `SourceDisclosure({ sourceIds, notes, disclosureScope, trigger? }: { sourceIds: readonly FeedbackId[]; notes: readonly FeedbackNote[]; disclosureScope: string; trigger?: ReactNode })` exported from `features/feedback/source-disclosure.tsx`. Default trigger text `Sources (n)`.
- Produces: UI store `setSourceOpen(key: string, open: boolean): void`, replacing `toggleSource`. `openSources` is now keyed by the item scope (`${generationId}:themes.0`), not `${scope}:${feedbackId}`.

- [ ] **Step 1: Rename the files with git**

```bash
git mv apps/web/src/features/feedback/source-reference.tsx apps/web/src/features/feedback/source-disclosure.tsx
git mv apps/web/src/features/feedback/source-reference.test.tsx apps/web/src/features/feedback/source-disclosure.test.tsx
```

- [ ] **Step 2: Write the failing tests**

Replace the whole of `apps/web/src/features/feedback/source-disclosure.test.tsx` with:

```tsx
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { FeedbackIdSchema, SUPPLIED_FEEDBACK } from "@event-desk/contracts";
import { FIXTURE_TIME } from "@event-desk/contracts/testing";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useUiStore } from "../../state/ui-store";
import { SourceDisclosure } from "./source-disclosure";

const NOTES = SUPPLIED_FEEDBACK.map((note) => ({ ...note, receivedAt: FIXTURE_TIME }));
const ids = (...raw: string[]) => raw.map((id) => FeedbackIdSchema.parse(id));
const renderDisclosure = (sourceIds: string[], trigger?: ReactNode) =>
  render(
    <Theme theme={neutralTheme}>
      <SourceDisclosure
        sourceIds={ids(...sourceIds)}
        notes={NOTES}
        disclosureScope="g1:themes.0"
        {...(trigger === undefined ? {} : { trigger })}
      />
    </Theme>,
  );

describe("SourceDisclosure (F3 inspection, amended 2026-10-04)", () => {
  it("Review Focus 5: a keyboard user opens an item's cited notes inline and the toggle states it", async () => {
    const user = userEvent.setup();
    renderDisclosure(["F05", "F06"]);
    const toggle = screen.getByRole("button", { name: "Sources (2)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.tab();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const controlled = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(controlled?.textContent).toContain(NOTES[4]?.text);
    expect(controlled?.textContent).toContain(NOTES[5]?.text);
    // T3 §11: the open state lives in the UI store under the item's scope.
    expect(useUiStore.getState().openSources["g1:themes.0"]).toBe(true);
    expect(document.activeElement).toBe(toggle); // inspection never moves focus
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(useUiStore.getState().openSources["g1:themes.0"]).toBeUndefined();
  });

  it("uses the item's row as the trigger when one is given", async () => {
    const user = userEvent.setup();
    renderDisclosure(["F05", "F06"], <span>Requests for more rest-break time.</span>);
    const row = screen.getByRole("button", { name: /^Requests for more rest-break time\./ });
    await user.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
  });

  it("Review Focus 4 / F3: a missing ID is an error shown without opening anything", () => {
    renderDisclosure(["F05", "F99"]);
    expect(screen.getByText("Source F99 is unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sources (1)" })).toBeTruthy();
  });

  it("Review Focus 4 / F3: with no available note there is no toggle, but the row text stays", () => {
    renderDisclosure(["F99"], <span>Row text</span>);
    expect(screen.getByText("Row text")).toBeTruthy();
    expect(screen.getByText("Source F99 is unavailable")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/src/features/feedback/source-disclosure.test.tsx`
Expected: FAIL — `SourceDisclosure` is not exported from `./source-disclosure`.

- [ ] **Step 4: Update the UI store**

In `apps/web/src/state/ui-store.ts`, replace the `openSources` / `toggleSource` declarations and
implementation:

```ts
  /** Open source disclosures, by item scope (`${generationId}:themes.0`); they survive editor remounts. */
  openSources: Readonly<Record<string, true>>;
  setSourceOpen: (key: string, open: boolean) => void;
```

```ts
  openSources: {},
  setSourceOpen: (key, open) => {
    set(({ openSources }) => ({
      openSources: open
        ? { ...openSources, [key]: true }
        : Object.fromEntries(Object.entries(openSources).filter(([openKey]) => openKey !== key)),
    }));
  },
```

- [ ] **Step 5: Write the component**

Replace the whole of `apps/web/src/features/feedback/source-disclosure.tsx` with:

```tsx
import { Badge } from "@astryxdesign/core/Badge";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { FeedbackId, FeedbackNote } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { useUiStore } from "../../state/ui-store";

const styles = stylex.create({
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  // Astryx Badge may shrink with an ellipsis; the note ID must always be readable in full.
  noteId: { flexShrink: 0 },
  note: { minWidth: 0, overflowWrap: "anywhere" },
});

/**
 * F3 "Reading and inspection flow" (amended 2026-10-04): one disclosure per briefing item reveals
 * every note it cites, inline and as plain text, without moving focus or touching the editor. The
 * open state lives in the UI store under the item's scope (T3 §11), so a disclosure opened before a
 * save stays open when the editor remounts on the same generation and item. A cited ID that is not
 * among the event's notes is an error, shown without opening anything.
 */
export function SourceDisclosure({
  sourceIds,
  notes,
  disclosureScope,
  trigger,
}: {
  sourceIds: readonly FeedbackId[];
  notes: readonly FeedbackNote[];
  /** Which item these sources belong to, e.g. `${generationId}:themes.0`. */
  disclosureScope: string;
  /** What the coordinator activates (the item's row); defaults to "Sources (n)". */
  trigger?: ReactNode;
}) {
  const isOpen = useUiStore((state) => state.openSources[disclosureScope] === true);
  const setSourceOpen = useUiStore((state) => state.setSourceOpen);
  const byId = new Map(notes.map((note) => [note.id as string, note]));
  const cited = sourceIds.flatMap((id) => {
    const note = byId.get(id);
    return note === undefined ? [] : [note];
  });
  const missing = sourceIds.filter((id) => !byId.has(id));
  return (
    <VStack gap={1}>
      {cited.length === 0 ? (
        trigger
      ) : (
        <Collapsible
          isOpen={isOpen}
          onOpenChange={(open) => {
            setSourceOpen(disclosureScope, open);
          }}
          chevronPosition="start"
          trigger={trigger ?? `Sources (${String(cited.length)})`}
        >
          <ul aria-label="Sources" {...stylex.props(styles.list)}>
            {cited.map((note) => (
              <li key={note.id}>
                <HStack gap={2}>
                  <span {...stylex.props(styles.noteId)}>
                    <Badge variant="neutral" label={note.id} />
                  </span>
                  <div {...stylex.props(styles.note)}>
                    <Text>{note.text}</Text>
                  </div>
                </HStack>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
      {missing.map((id) => (
        <div key={id}>
          <Badge variant="error" label={`Source ${id} is unavailable`} />
        </div>
      ))}
    </VStack>
  );
}
```

- [ ] **Step 6: Switch the two callers**

In `apps/web/src/features/briefing/briefing-preview.tsx` and
`apps/web/src/features/briefing/briefing-editor.tsx`, replace
`import { SourceReferences } from "../feedback/source-reference";` with
`import { SourceDisclosure } from "../feedback/source-disclosure";` and rename every
`<SourceReferences` to `<SourceDisclosure` (the props are unchanged).

- [ ] **Step 7: Update the briefing tests that clicked "Read source F05"**

The fixture's feedback summary cites 8 notes ("Sources (8)"); Theme 1 cites F05 and F06 and
renders before the disagreements and follow-ups, so it is the first "Sources (2)".

In `apps/web/src/features/briefing/briefing-editor.test.tsx`:
- Test "F5-01": replace the line
  `expect(region.getAllByRole("button", { name: "Read source F05" }).length).toBeGreaterThan(0);`
  and the comment above it with
  `expect(region.getByRole("button", { name: "Sources (8)" })).toBeTruthy();`
- Test "Review Focus 5 / F5-05": replace
  `const toggle = region.getAllByRole("button", { name: "Read source F05" })[1];` with
  `const toggle = region.getAllByRole("button", { name: "Sources (2)" })[0];`

In `apps/web/src/features/briefing/briefing-panel.test.tsx`:
- Test "F4-01 / F4 step 7": replace
  `expect(region.getAllByRole("button", { name: "Read source F05" }).length).toBeGreaterThan(0);`
  with `expect(region.getByRole("button", { name: "Sources (8)" })).toBeTruthy();`
- Test "shows an unreviewed incoming preview read-only…": replace the two lines
  `const [toggle] = region.getAllByRole("button", { name: "Read source F05" });` and
  `if (toggle === undefined) throw new Error("source toggle missing");` with
  `const toggle = region.getByRole("button", { name: "Sources (8)" });`
- Test "T3 §11: a source opened before a save stays open…": inside `themeToggle`, replace
  `const [, toggle] = region.getAllByRole("button", { name: "Read source F05" });` with
  `const [toggle] = region.getAllByRole("button", { name: "Sources (2)" });`, and replace
  `const [summaryToggle] = region.getAllByRole("button", { name: "Read source F05" });` with
  `const summaryToggle = region.getByRole("button", { name: "Sources (8)" });`

- [ ] **Step 8: Run the web tests**

Run: `pnpm vitest run --project web`
Expected: PASS (all web tests, including the four new SourceDisclosure tests).

- [ ] **Step 9: Verify and commit**

Run: `pnpm verify` — Expected: PASS.

```bash
git add -A apps/web/src
git commit -m "feat(web): one source disclosure per briefing item (F3 amendment)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Attendance as a Name/Actions table with an Astryx Selector

**Files:**
- Create: `apps/web/src/testing/selector.ts`
- Modify: `apps/web/src/features/attendance/attendance-panel.tsx`
- Modify tests: `apps/web/src/features/attendance/attendance-panel.test.tsx`, `apps/web/src/features/briefing/briefing-panel.test.tsx` (test "F4 step 1")

**Interfaces:**
- Produces: `chooseOption(user: UserEvent, scope: ReturnType<typeof within>, label: string, option: string): Promise<void>` in `testing/selector.ts`.
- Consumes: `AttendanceStatusSchema`, `ATTENDANCE_STATUSES`, `ATTENDANCE_LABELS` from `@event-desk/contracts` (exist today).

Facts the tests rely on (verified with a spike in jsdom): the Selector trigger is a `<button
role="combobox">` named by `label` (also with `isLabelHidden`); its text is the selected option's
label; `isDisabled` sets native `disabled`; the listbox renders inside the panel; Enter opens it on
the selected option, ArrowUp/ArrowDown move, Enter picks and focus returns to the trigger. Seed
statuses: Alex attended, Bea absent, Chris not recorded, Drew absent.

- [ ] **Step 1: Add the test helper**

Create `apps/web/src/testing/selector.ts`:

```ts
import type { within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

type Queries = ReturnType<typeof within>;

/** Picks an option in an Astryx Selector (a combobox button and its listbox) by their names. */
export async function chooseOption(
  user: UserEvent,
  scope: Queries,
  label: string,
  option: string,
): Promise<void> {
  await user.click(scope.getByRole("combobox", { name: label }));
  await user.click(scope.getByRole("option", { name: option }));
}
```

- [ ] **Step 2: Rewrite the attendance tests for the Selector**

In `apps/web/src/features/attendance/attendance-panel.test.tsx`:
- Add `import { chooseOption } from "../../testing/selector";` and change the `select` helper's type
  argument from `HTMLSelectElement` to `HTMLButtonElement`.
- Replace every `await user.selectOptions(select(region, NAME), "attended");` with
  `await chooseOption(user, region, NAME, "Attended");` and every
  `await user.selectOptions(select(region, NAME), "not_recorded");` with
  `await chooseOption(user, region, NAME, "Not recorded");`.
- Replace `.value).toBe("attended")` with `.textContent).toBe("Attended")` and
  `.value).toBe("not_recorded")` with `.textContent).toBe("Not recorded")`.
- Replace the body of "offers exactly the three states…" with:

```ts
    const { user } = renderApp();
    const region = await panel();
    await user.click(select(region, "Chris"));
    const options = region.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Attended", "Absent", "Not recorded"]);
```

- Replace the body of "F2-10: every control is reachable and operable by keyboard" with:

```ts
    const { user } = renderApp();
    const region = await panel();
    act(() => {
      select(region, "Alex").focus();
    });
    for (const name of ["Bea", "Chris", "Drew"]) {
      await user.tab();
      expect(document.activeElement).toBe(select(region, name));
    }
    // Drew is Absent: Enter opens the list on it, ArrowUp moves to Attended, Enter picks it.
    await user.keyboard("{Enter}");
    expect(await region.findByRole("listbox")).toBeTruthy();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(select(region, "Drew").textContent).toBe("Attended");
    expect(document.activeElement).toBe(select(region, "Drew"));
    await user.tab();
    expect(document.activeElement).toBe(region.getByRole("button", { name: "Save attendance" }));
    await user.keyboard("{Enter}");
    await toastShown("Attendance saved");
```

- Add this test inside the `describe`:

```ts
  it("shows the members as a table with Name and Actions columns", async () => {
    renderApp();
    const region = await panel();
    const table = region.getByRole("table", { name: "Member attendance" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "Actions",
    ]);
    const rows = within(table)
      .getAllByRole("row")
      .filter((row) => within(row).queryAllByRole("columnheader").length === 0);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
      "Alex",
      "Bea",
      "Chris",
      "Drew",
    ]);
  });
```

In `apps/web/src/features/briefing/briefing-panel.test.tsx`, test "F4 step 1": add
`import { chooseOption } from "../../testing/selector";` and replace
`await user.selectOptions(attendance.getByRole("combobox", { name: "Chris" }), "attended");` with
`await chooseOption(user, attendance, "Chris", "Attended");`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/src/features/attendance/attendance-panel.test.tsx`
Expected: FAIL — no table named "Member attendance"; no `option` named "Attended" after clicking a
native select.

- [ ] **Step 4: Rewrite the attendance form markup**

In `apps/web/src/features/attendance/attendance-panel.tsx`:
- Remove the `Field` import. Add:

```tsx
import { Selector } from "@astryxdesign/core/Selector";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@astryxdesign/core/Table";
import { Controller } from "react-hook-form";
```

  and add `AttendanceStatusSchema` to the `@event-desk/contracts` import.
- Above `NoticeBanner`, add:

```tsx
const ATTENDANCE_OPTIONS = ATTENDANCE_STATUSES.map((status) => ({
  value: status,
  label: ATTENDANCE_LABELS[status],
}));
```

- Replace the `<VStack gap={3}>` inside the `<form>` up to (not including) the
  `{attendance.isDirty ? (<Text>Unsaved attendance changes…` block with:

```tsx
          <VStack gap={3}>
            <AttendanceCounts
              saved={view.counts}
              draft={deriveAttendanceCounts(attendance.draft)}
              isDirty={attendance.isDirty}
            />
            <Table aria-label="Member attendance" density="compact">
              <TableHeader>
                <TableRow isHeaderRow>
                  <TableHeaderCell scope="col">Name</TableHeaderCell>
                  <TableHeaderCell scope="col">Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.draft.map((member, index) => {
                  const name = names.get(member.id) ?? member.id;
                  return (
                    <TableRow key={member.id}>
                      <TableCell>{name}</TableCell>
                      <TableCell>
                        <Controller
                          control={attendance.form.control}
                          name={`members.${index}.attendance`}
                          render={({ field }) => (
                            // The Name column shows the member visually; the label names the control.
                            <Selector
                              label={name}
                              isLabelHidden
                              options={ATTENDANCE_OPTIONS}
                              value={field.value}
                              isDisabled={attendance.isBusy}
                              onChange={(value) => {
                                const status = AttendanceStatusSchema.safeParse(value);
                                if (status.success) field.onChange(status.data);
                              }}
                            />
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
```

  and delete the old `<AttendanceCounts … />` element that followed the member list (the counts
  now sit above the table). Everything from the unsaved-changes text down stays as it is.

- [ ] **Step 5: Run the web tests**

Run: `pnpm vitest run --project web`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `pnpm verify` — Expected: PASS.

```bash
git add -A apps/web/src
git commit -m "feat(web): attendance as a Name/Actions table with an Astryx Selector (F2 amendment)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Feedback as an ID/Note table

**Files:**
- Modify: `apps/web/src/features/feedback/feedback-panel.tsx`
- Modify test: `apps/web/src/features/feedback/feedback-panel.test.tsx`

**Interfaces:** `FeedbackPanel` props are unchanged.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/features/feedback/feedback-panel.test.tsx`, add below `panel`:

```ts
/** Body rows of the notes table, in display order (the header row holds the column headers). */
const noteRows = (region: Awaited<ReturnType<typeof panel>>) =>
  region
    .getAllByRole("row")
    .filter((row) => within(row).queryAllByRole("columnheader").length === 0);
```

Replace `(await panel()).getAllByRole("listitem")` with `noteRows(await panel())` in tests "F3-01"
and "F6-18". Add:

```ts
  it("shows the notes as a table with ID and Note columns", async () => {
    renderApp();
    const table = (await panel()).getByRole("table", { name: "Feedback notes" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "ID",
      "Note",
    ]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/src/features/feedback/feedback-panel.test.tsx`
Expected: FAIL — no `row` / no table named "Feedback notes".

- [ ] **Step 3: Rewrite the panel**

Replace the `FeedbackPanel` function in `apps/web/src/features/feedback/feedback-panel.tsx` (keep the
file's doc comment, `styles` and `NO_NEW_NOTES`), and add the `Table` imports
(`Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow` from
`@astryxdesign/core/Table`):

```tsx
export function FeedbackPanel({
  notes,
  newSinceBriefing = NO_NEW_NOTES,
}: {
  notes: readonly FeedbackNote[];
  /** Notes that are not in the displayed briefing's input. */
  newSinceBriefing?: ReadonlySet<FeedbackId>;
}) {
  return (
    <section aria-label="Feedback">
      <VStack gap={2}>
        <HStack gap={2} justify="between" align="center">
          <Heading level={2}>Feedback</Heading>
          <Link href={`/events/${EVENT_ID}/feedback`} isExternalLink>
            Open feedback form (test)
          </Link>
        </HStack>
        <Text type="supporting">
          {notes.length} anonymous notes from the event feedback form. Read-only and not linked to
          members.
        </Text>
        {notes.length === 0 ? (
          <Text>No feedback notes yet.</Text>
        ) : (
          <Table aria-label="Feedback notes" density="compact" verticalAlign="top">
            <TableHeader>
              <TableRow isHeaderRow>
                <TableHeaderCell scope="col">ID</TableHeaderCell>
                <TableHeaderCell scope="col">Note</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notes.map((note) => (
                <TableRow key={note.id}>
                  <TableCell>
                    <VStack gap={1}>
                      <span {...stylex.props(styles.noteId)}>
                        <Badge variant="neutral" label={note.id} />
                      </span>
                      {newSinceBriefing.has(note.id) ? (
                        <Badge variant="info" label="New since this briefing" />
                      ) : null}
                    </VStack>
                  </TableCell>
                  <TableCell>
                    <div {...stylex.props(styles.noteText)}>
                      <Text>{note.text}</Text>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </VStack>
    </section>
  );
}
```

- [ ] **Step 4: Run the web tests**

Run: `pnpm vitest run --project web`
Expected: PASS (feedback, live-updates and panel-error-boundary tests included).

- [ ] **Step 5: Verify and commit**

Run: `pnpm verify` — Expected: PASS.

```bash
git add -A apps/web/src
git commit -m "feat(web): feedback notes as an ID/Note table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared briefing layout and the read view

One arrangement for both views: highlighted "What happened" card first, themes | disagreements in
two columns, follow-ups full width. Read-only briefings (`BriefingPreview`) switch to the read view
now; the editor keeps its always-on text areas in this task but adopts the same layout.

**Files:**
- Create: `apps/web/src/features/briefing/briefing-sections.tsx`
- Create: `apps/web/src/features/briefing/briefing-content-view.tsx`
- Create: `apps/web/src/features/briefing/briefing-content-view.test.tsx`
- Create: `apps/web/src/testing/briefing-queries.ts`
- Modify: `apps/web/src/features/briefing/briefing-preview.tsx`
- Modify: `apps/web/src/features/briefing/briefing-editor.tsx`

**Interfaces:**
- Produces (`briefing-sections.tsx`): `SummaryCard({ children }: { children: ReactNode })`;
  `BriefingSectionsLayout({ summary, renderItems }: { summary: ReactNode; renderItems: (section: ListSection) => readonly ReactNode[] })`.
  Each section renders `<Heading level={4}>` with its `SECTION_COPY` title and an `<ol>` labelled by
  that heading (so `getByRole("list", { name: "Which themes recur" })` finds it), or the section's
  empty copy.
- Produces (`briefing-content-view.tsx`): `BriefingContentView({ content, notes, disclosureScope }: { content: BriefingContent; notes: readonly FeedbackNote[]; disclosureScope: string })`.
  Disclosure scopes: `${disclosureScope}:feedbackSummary` and `${disclosureScope}:${section}.${index}`.
- Produces (`testing/briefing-queries.ts`): `sectionItem(scope, section, index = 0): HTMLElement`;
  `expectReadItem(scope, section, text, index = 0): void`;
  `startEditing(user, scope): Promise<void>` (used from Task 6).
- Consumes: `SourceDisclosure` (Task 1).

- [ ] **Step 1: Add the test queries**

Create `apps/web/src/testing/briefing-queries.ts`:

```ts
import { within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { expect } from "vitest";

type Queries = ReturnType<typeof within>;

/**
 * One item of a briefing section, in the read view or the edit view, by the section's heading. The
 * first list with that name is the editor's (or the only briefing on screen).
 */
export function sectionItem(scope: Queries, section: string, index = 0): HTMLElement {
  const [list] = scope.getAllByRole("list", { name: section });
  const item = list?.children.item(index);
  if (!(item instanceof HTMLElement)) {
    throw new Error(`${section}: item ${String(index + 1)} is missing`);
  }
  return item;
}

/** The read view shows this wording for the item: no text area, the text itself. */
export function expectReadItem(scope: Queries, section: string, text: string, index = 0): void {
  const item = within(sectionItem(scope, section, index));
  expect(item.queryByRole("textbox")).toBeNull();
  expect(item.getByText(text)).toBeTruthy();
}

/** The briefing opens read-only (spec 2026-10-04): Edit briefing opens its text areas. */
export async function startEditing(user: UserEvent, scope: Queries): Promise<void> {
  await user.click(scope.getByRole("button", { name: "Edit briefing" }));
  await scope.findByRole("button", { name: "Cancel edit" });
}
```

- [ ] **Step 2: Write the failing read-view tests**

Create `apps/web/src/features/briefing/briefing-content-view.test.tsx`:

```tsx
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { type BriefingContent, SUPPLIED_FEEDBACK } from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useUiStore } from "../../state/ui-store";
import { expectReadItem, sectionItem } from "../../testing/briefing-queries";
import { BriefingContentView } from "./briefing-content-view";

const NOTES = SUPPLIED_FEEDBACK.map((note) => ({ ...note, receivedAt: FIXTURE_TIME }));
const CONTENT = buildBriefingView().content;
const renderView = (content: BriefingContent = CONTENT) =>
  render(
    <Theme theme={neutralTheme}>
      <BriefingContentView content={content} notes={NOTES} disclosureScope="g1" />
    </Theme>,
  );

describe("briefing read view (spec 2026-10-04)", () => {
  it("leads with the feedback summary, then the attendance overview, before every list", () => {
    renderView();
    const summary = screen.getByText(CONTENT.feedbackSummary.text);
    const overview = screen.getByText(CONTENT.attendanceOverview);
    const firstTheme = screen.getByText("Requests for more rest-break time.");
    expect(summary.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(overview.compareDocumentPosition(firstTheme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("asks the brief's four questions in order: summary, themes, disagreements, follow-ups", () => {
    renderView();
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual([
      "What happened",
      "Which themes recur",
      "Where people disagree",
      "What might be worth following up",
    ]);
    expectReadItem(screen, "Where people disagree", "One note asks for an earlier start; another says it would be difficult.", 1);
    expectReadItem(screen, "What might be worth following up", "Consider reviewing the route length.", 1);
  });

  it("a row shows its cited IDs and expands to show the cited notes", async () => {
    const user = userEvent.setup();
    renderView();
    const row = within(sectionItem(screen, "Which themes recur")).getByRole("button", {
      name: /^Requests for more rest-break time\./,
    });
    expect(within(row).getByText("F05")).toBeTruthy();
    expect(within(row).getByText("F06")).toBeTruthy();
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await user.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    const notes = document.getElementById(row.getAttribute("aria-controls") ?? "");
    expect(notes?.textContent).toContain(NOTES[4]?.text);
    expect(useUiStore.getState().openSources["g1:themes.0"]).toBe(true);
  });

  it("S1: renders model text inertly and says when a section is empty", () => {
    renderView({
      ...CONTENT,
      themes: [],
      suggestions: [{ text: '<img src=x onerror="alert(1)"> **Check**', sourceIds: CONTENT.suggestions[1]?.sourceIds ?? [] }],
    });
    expect(screen.getByText("No recurring themes identified.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Which themes recur" })).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)"> **Check**')).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/src/features/briefing/briefing-content-view.test.tsx`
Expected: FAIL — `./briefing-content-view` does not exist.

- [ ] **Step 4: Write the shared layout**

Create `apps/web/src/features/briefing/briefing-sections.tsx`:

```tsx
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { ListSection } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useId } from "react";
import { SECTION_COPY } from "./briefing-copy";

const styles = stylex.create({
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
});

/** Side by side on wide screens (spec 2026-10-04); follow-ups take the full width below them. */
const COLUMN_SECTIONS = ["themes", "conflicts"] as const satisfies readonly ListSection[];

/** "What happened", highlighted and first: the feedback summary leads the briefing. */
export function SummaryCard({ children }: { children: ReactNode }) {
  return (
    <Card variant="blue" padding={4}>
      <VStack gap={2}>
        <Heading level={4}>What happened</Heading>
        {children}
      </VStack>
    </Card>
  );
}

/** One of the brief's questions; its heading names the list, so each item is found by section. */
function BriefingSection({ section, items }: { section: ListSection; items: readonly ReactNode[] }) {
  const headingId = useId();
  return (
    <VStack gap={2}>
      <Heading level={4} id={headingId}>
        {SECTION_COPY[section].title}
      </Heading>
      {items.length === 0 ? (
        <Text type="supporting">{SECTION_COPY[section].empty}</Text>
      ) : (
        <ol aria-labelledby={headingId} {...stylex.props(styles.list)}>
          {items.map((item, index) => (
            <li key={`${section}-${String(index)}`}>{item}</li>
          ))}
        </ol>
      )}
    </VStack>
  );
}

/** The briefing's arrangement, shared by the read view and the edit view so they cannot drift. */
export function BriefingSectionsLayout({
  summary,
  renderItems,
}: {
  summary: ReactNode;
  renderItems: (section: ListSection) => readonly ReactNode[];
}) {
  return (
    <VStack gap={4}>
      {summary}
      <Grid columns={{ minWidth: 280, max: 2 }} gap={4}>
        {COLUMN_SECTIONS.map((section) => (
          <BriefingSection key={section} section={section} items={renderItems(section)} />
        ))}
      </Grid>
      <BriefingSection section="suggestions" items={renderItems("suggestions")} />
    </VStack>
  );
}
```

- [ ] **Step 5: Write the read view**

Create `apps/web/src/features/briefing/briefing-content-view.tsx`:

```tsx
import { Badge } from "@astryxdesign/core/Badge";
import { Text } from "@astryxdesign/core/Text";
import type { BriefingContent, EvidenceItem, FeedbackNote } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import { SourceDisclosure } from "../feedback/source-disclosure";
import { BriefingSectionsLayout, SummaryCard } from "./briefing-sections";

// Spans only: the row sits inside the disclosure's <button>, which allows phrasing content alone.
const styles = stylex.create({
  row: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    textAlign: "start",
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  ids: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.25rem" },
});

/** F3: the item's wording with its cited IDs beside it; activating the row reveals the notes. */
function EvidenceRow({
  item,
  notes,
  disclosureScope,
}: {
  item: EvidenceItem;
  notes: readonly FeedbackNote[];
  disclosureScope: string;
}) {
  return (
    <SourceDisclosure
      sourceIds={item.sourceIds}
      notes={notes}
      disclosureScope={disclosureScope}
      trigger={
        <span {...stylex.props(styles.row)}>
          <Text>{item.text}</Text>
          <span {...stylex.props(styles.ids)}>
            <Text type="supporting">Sources</Text>
            {item.sourceIds.map((id) => (
              <Badge key={id} variant="neutral" label={id} />
            ))}
          </span>
        </span>
      }
    />
  );
}

/**
 * A briefing's content, read-only (spec 2026-10-04): the feedback summary first and highlighted,
 * then the recurring themes and disagreements side by side, then follow-ups. Model and human text
 * is rendered as plain text (S1).
 */
export function BriefingContentView({
  content,
  notes,
  disclosureScope,
}: {
  content: BriefingContent;
  notes: readonly FeedbackNote[];
  /** Prefix of each item's disclosure key, e.g. a generation ID. */
  disclosureScope: string;
}) {
  return (
    <BriefingSectionsLayout
      summary={
        <SummaryCard>
          <Text type="large">{content.feedbackSummary.text}</Text>
          <Text type="supporting">{content.attendanceOverview}</Text>
          <SourceDisclosure
            sourceIds={content.feedbackSummary.sourceIds}
            notes={notes}
            disclosureScope={`${disclosureScope}:feedbackSummary`}
          />
        </SummaryCard>
      }
      renderItems={(section) =>
        content[section].map((item, index) => (
          <EvidenceRow
            item={item}
            notes={notes}
            disclosureScope={`${disclosureScope}:${section}.${String(index)}`}
          />
        ))
      }
    />
  );
}
```

- [ ] **Step 6: Use the read view in `BriefingPreview`**

Replace the whole of `apps/web/src/features/briefing/briefing-preview.tsx` with:

```tsx
import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { BriefingView, EventView } from "@event-desk/contracts";
import { EVIDENCE_LIMIT_NOTICE, formatTimestamp } from "./briefing-copy";
import { BriefingContentView } from "./briefing-content-view";
import { FreshnessNotice } from "./freshness-notice";

/**
 * A read-only briefing (F4): code-built overview, cited model text, rendered as plain text (S1).
 * Headings are the brief's four questions; they are headings, not landmarks.
 */
export function BriefingPreview({
  title,
  briefing,
  view,
}: {
  title: string;
  briefing: BriefingView;
  view: EventView;
}) {
  const { content, provenance } = briefing;
  return (
    <article aria-label={title}>
      <VStack gap={3}>
        <Heading level={3}>{title}</Heading>
        <Text type="supporting">
          Generated {formatTimestamp(provenance.generatedAt)} · {provenance.model} ·{" "}
          {briefing.trigger === "manual" ? "requested by you" : "automatic"}
        </Text>
        <FreshnessNotice briefing={briefing} members={view.members} counts={view.counts} />
        <Text type="supporting">{EVIDENCE_LIMIT_NOTICE}</Text>
        {/* Its own disclosure state: a read-only copy never opens or closes the editor's sources. */}
        <BriefingContentView
          content={content}
          notes={view.feedback}
          disclosureScope={`${provenance.generationId}:readonly`}
        />
      </VStack>
    </article>
  );
}
```

- [ ] **Step 7: Give the editor the same arrangement**

In `apps/web/src/features/briefing/briefing-editor.tsx`, add
`import { BriefingSectionsLayout, SummaryCard } from "./briefing-sections";`, remove
`LIST_SECTIONS` from the contracts import, and replace everything inside `<VStack gap={4}>` of the
`<form>` from the `<VStack gap={2}><Heading level={4}>What happened</Heading>` block through the end
of the `{LIST_SECTIONS.map(...)}` block with:

```tsx
            <BriefingSectionsLayout
              summary={
                <SummaryCard>
                  <TextField
                    control={control}
                    name="feedbackSummary"
                    label="Feedback summary"
                    isDisabled={fieldsDisabled}
                  />
                  <SourceDisclosure
                    sourceIds={content.feedbackSummary.sourceIds}
                    notes={view.feedback}
                    disclosureScope={`${briefing.provenance.generationId}:feedbackSummary`}
                  />
                  <TextField
                    control={control}
                    name="attendanceOverview"
                    label="Attendance overview"
                    isDisabled={fieldsDisabled}
                  />
                  <VStack gap={0}>
                    <Text type="supporting">Check edited wording against the counts.</Text>
                    <Text type="supporting">
                      Generated from: {formatAttendanceCounts(briefing.provenance.input.counts)}
                    </Text>
                    <Text type="supporting">
                      Saved records now: {formatAttendanceCounts(view.counts)}
                    </Text>
                  </VStack>
                </SummaryCard>
              }
              renderItems={(section) =>
                content[section].map((item, index) => (
                  <VStack gap={1}>
                    <TextField
                      control={control}
                      name={`${section}.${index}.text`}
                      label={`${SECTION_COPY[section].itemLabel} ${String(index + 1)}`}
                      isDisabled={fieldsDisabled}
                    />
                    <SourceDisclosure
                      sourceIds={item.sourceIds}
                      notes={view.feedback}
                      disclosureScope={`${briefing.provenance.generationId}:${section}.${String(index)}`}
                    />
                  </VStack>
                ))
              }
            />
```

The status line, notices, conflict comparison and buttons that follow stay unchanged.

- [ ] **Step 8: Run the web tests**

Run: `pnpm vitest run --project web`
Expected: PASS (the new read-view tests and every existing test; Theme 1 is still the first
"Sources (2)" in the editor).

- [ ] **Step 9: Verify and commit**

Run: `pnpm verify` — Expected: PASS.

```bash
git add -A apps/web/src
git commit -m "feat(web): briefing read view with highlighted summary and two-column sections

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Generate briefing in the section header

Move the Generate control's state into a hook so the button sits on the right of the "Briefing"
heading while its status, batch status, error banner and retry dialog stay below. Behaviour is
unchanged.

**Files:**
- Create: `apps/web/src/features/briefing/use-generate-control.ts`
- Rename: `apps/web/src/features/briefing/generate-briefing-control.test.ts` → `apps/web/src/features/briefing/use-generate-control.test.ts`
- Modify: `apps/web/src/features/briefing/generate-briefing-control.tsx`
- Modify: `apps/web/src/features/briefing/briefing-panel.tsx`
- Modify test: `apps/web/src/features/briefing/briefing-panel.test.tsx`

**Interfaces:**
- Produces: `useGenerateControl(eventId: EventId, view: EventView, onGenerated?: (preview: BriefingView) => void)` returning
  `{ generation, attendanceDirty, busy, elsewhere, cooldownUntil, canGenerate, press, confirmingRetry, confirmRetry, cancelRetry }`;
  `type GenerateControl = ReturnType<typeof useGenerateControl>`; `mayHaveBeenCharged(error: unknown): boolean` (moved here).
- Produces: `GenerateBriefingButton({ control }: { control: GenerateControl })` and
  `GenerateBriefingStatus({ control, view }: { control: GenerateControl; view: EventView })` from `generate-briefing-control.tsx`
  (the old `GenerateBriefingControl` export is removed).

- [ ] **Step 1: Write the failing test**

Add to the first `describe("briefing panel")` in `apps/web/src/features/briefing/briefing-panel.test.tsx`:

```ts
  it("puts Generate briefing in the section header, beside the heading", async () => {
    renderApp();
    const region = await panel();
    const heading = region.getByRole("heading", { level: 2, name: "Briefing" });
    expect(heading.parentElement?.contains(generateButton(region))).toBe(true);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/src/features/briefing/briefing-panel.test.tsx -t "section header"`
Expected: FAIL — the button is not inside the heading's parent.

- [ ] **Step 3: Move the state into a hook**

```bash
git mv apps/web/src/features/briefing/generate-briefing-control.test.ts apps/web/src/features/briefing/use-generate-control.test.ts
```

In that test file change the import to `import { mayHaveBeenCharged } from "./use-generate-control";`.

Create `apps/web/src/features/briefing/use-generate-control.ts`:

```ts
import type { BriefingView, EventId, EventView, HttpErrorCode } from "@event-desk/contracts";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../data/http/api-error";
import { useGenerateBriefing } from "../../data/mutations/use-generate-briefing";
import { useUiStore } from "../../state/ui-store";
import { useOutcomeAnnouncements } from "./use-outcome-announcements";

/** The earlier attempt may have reached the provider (F8): Retry asks before paying again (T3 §11). */
const UNCERTAIN_CODES: ReadonlySet<HttpErrorCode> = new Set([
  "AI_OUTCOME_UNKNOWN",
  "DEADLINE_EXCEEDED",
]);

export function mayHaveBeenCharged(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.outcomeUnknown || (error.code !== undefined && UNCERTAIN_CODES.has(error.code));
}

/**
 * Generate and Retry are the same synchronous call (A6); attendance must be saved first (F4), and a
 * provider cooldown (F8) holds it until the server says it ends. One state for the header button
 * and the status shown below it.
 */
export function useGenerateControl(
  eventId: EventId,
  view: EventView,
  /** After THIS tab's Generate succeeds (F4 step 7): the panel decides whether to open it. */
  onGenerated?: (preview: BriefingView) => void,
) {
  const generation = useGenerateBriefing(eventId);
  const attendanceDirty = useUiStore((state) => state.attendanceDirty);
  const [confirmingRetry, setConfirmingRetry] = useState(false);
  useOutcomeAnnouncements(view.generation.lastOutcome);

  // Plan 3B carry-forward: a Retry banner is stale once a different incoming preview arrives.
  const incomingId = view.incomingPreview?.provenance.generationId ?? null;
  const [incomingAtError, setIncomingAtError] = useState<string | null>(null);
  // The failure is judged against the preview present when it lands, not when Generate was pressed:
  // a batch may commit a new preview while the manual call is in flight.
  const latestIncoming = useRef(incomingId);
  useEffect(() => {
    latestIncoming.current = incomingId;
  }, [incomingId]);
  useEffect(() => {
    if (generation.isError && incomingId !== incomingAtError) generation.reset();
  }, [generation, incomingId, incomingAtError]);

  const elsewhere = view.generation.manual !== null && !generation.isPending;
  const busy = generation.isPending || view.generation.manual !== null;
  const { cooldownUntil } = view.generation;
  const cooling = cooldownUntil !== null;
  const start = () => {
    generation.mutate(
      { baseAttendanceRevision: view.attendanceRevision },
      {
        onSuccess: (response) => onGenerated?.(response.incomingPreview),
        onError: () => {
          setIncomingAtError(latestIncoming.current);
        },
      },
    );
  };
  const press = () => {
    if (busy || attendanceDirty || cooling) return;
    if (generation.isError && mayHaveBeenCharged(generation.error)) setConfirmingRetry(true);
    else start();
  };

  return {
    generation,
    attendanceDirty,
    busy,
    /** A generation started in another tab is running. */
    elsewhere,
    cooldownUntil,
    canGenerate: !busy && !attendanceDirty && !cooling,
    press,
    confirmingRetry,
    confirmRetry: () => {
      setConfirmingRetry(false);
      start();
    },
    cancelRetry: () => {
      setConfirmingRetry(false);
    },
  };
}

export type GenerateControl = ReturnType<typeof useGenerateControl>;
```

- [ ] **Step 4: Split the component**

Replace the whole of `apps/web/src/features/briefing/generate-briefing-control.tsx` with:

```tsx
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { EventView } from "@event-desk/contracts";
import { ApiError, describeApiError } from "../../data/http/api-error";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { BatchStatus } from "./batch-status";
import { formatClock } from "./batch-status-text";
import type { GenerateControl } from "./use-generate-control";

/** Generate briefing (or Retry), on the right of the Briefing section's header. */
export function GenerateBriefingButton({ control }: { control: GenerateControl }) {
  const { busy, generation, attendanceDirty, cooldownUntil, press } = control;
  return (
    <div>
      {/* While busy, Astryx renders aria-disabled (not native disabled) when a tooltip is set, so
          the button keeps keyboard focus (README "Screen and interaction"); press() ignores it.
          Unsaved attendance stays natively disabled: nothing was activated. */}
      <Button
        variant="primary"
        label={busy ? "Generating briefing…" : generation.isError ? "Retry" : "Generate briefing"}
        isLoading={busy}
        isDisabled={attendanceDirty || cooldownUntil !== null}
        {...(busy ? { tooltip: "Wait for the current generation to finish." } : {})}
        onClick={press}
      />
    </div>
  );
}

/** What Generate is doing or waiting for, the batch status, failures and the paid-retry check. */
export function GenerateBriefingStatus({
  control,
  view,
}: {
  control: GenerateControl;
  view: EventView;
}) {
  const { busy, elsewhere, attendanceDirty, cooldownUntil, generation } = control;
  return (
    <VStack gap={2}>
      <div role="status" aria-live="polite">
        {busy ? (
          <Text>
            {elsewhere
              ? "A briefing is being generated in another tab…"
              : "Generating briefing… This can take up to a minute."}
          </Text>
        ) : attendanceDirty ? (
          <Text>Save or discard your attendance changes before generating.</Text>
        ) : cooldownUntil !== null ? (
          <Text>
            {`The AI provider is limiting requests. Generate is available again at ${formatClock(cooldownUntil)}.`}
          </Text>
        ) : null}
      </div>
      <BatchStatus view={view} canGenerate={control.canGenerate} onGenerate={control.press} />
      {generation.isError && !busy ? (
        <Banner
          status="error"
          title={
            generation.error instanceof ApiError && generation.error.outcomeUnknown
              ? "Could not confirm the generation"
              : "Briefing was not generated"
          }
          description={describeApiError(generation.error)}
        />
      ) : null}
      <ConfirmDialog
        isOpen={control.confirmingRetry}
        title="Generate again?"
        description="The last attempt may have reached the AI provider and been charged. Check the briefing below first: generating again starts a new paid attempt."
        actionLabel="Generate again"
        isDestructive={false}
        onCancel={control.cancelRetry}
        onConfirm={control.confirmRetry}
      />
    </VStack>
  );
}
```

- [ ] **Step 5: Use them in the panel header**

In `apps/web/src/features/briefing/briefing-panel.tsx`:
- Replace the `GenerateBriefingControl` import with
  `import { GenerateBriefingButton, GenerateBriefingStatus } from "./generate-briefing-control";`
  and add `import { useGenerateControl } from "./use-generate-control";`. Add `HStack` to the
  `@astryxdesign/core/Layout` import.
- Directly after the `autoSelect` function, add:

```tsx
  const generate = useGenerateControl(eventId, view, autoSelect);
```

- Replace
  `<Heading level={2}>Briefing</Heading>` and
  `<GenerateBriefingControl eventId={eventId} view={view} onGenerated={autoSelect} />` with:

```tsx
        <HStack gap={3} justify="between" align="center">
          <Heading level={2}>Briefing</Heading>
          <GenerateBriefingButton control={generate} />
        </HStack>
        <GenerateBriefingStatus control={generate} view={view} />
```

- [ ] **Step 6: Run the web tests**

Run: `pnpm vitest run --project web`
Expected: PASS (the new header test, every Generate / batch-status / retry test unchanged).

- [ ] **Step 7: Verify and commit**

Run: `pnpm verify` — Expected: PASS.

```bash
git add -A apps/web/src
git commit -m "feat(web): Generate briefing in the briefing section header

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Read view first, Edit briefing and Cancel edit

**Files:**
- Modify: `apps/web/src/features/briefing/briefing-form-model.ts` (+ test)
- Modify: `apps/web/src/features/briefing/briefing-editor.tsx`
- Modify tests: `apps/web/src/features/briefing/briefing-editor.test.tsx`, `apps/web/src/features/briefing/briefing-panel.test.tsx`

**Interfaces:**
- Produces: `firstErrorField(errors: FieldErrors<BriefingFormValues>, values: BriefingFormValues): BriefingFieldPath | null` — the first field with an error in screen order (feedback summary, attendance overview, themes, disagreements, follow-ups).
- Consumes: `BriefingContentView` and `BriefingSectionsLayout`/`SummaryCard` (Task 4); `startEditing`, `sectionItem`, `expectReadItem` (Task 4 `testing/briefing-queries.ts`).

- [ ] **Step 1: Write the failing model test**

Add to `apps/web/src/features/briefing/briefing-form-model.test.ts` (import `firstErrorField` and
`toFormValues` from `./briefing-form-model`, `type FieldErrors` from `react-hook-form`, and
`buildBriefingView` from `@event-desk/contracts/testing` if not already imported):

```ts
  it("names the first field with an error, in screen order", () => {
    const values = toFormValues(buildBriefingView().content);
    const server = { type: "server", message: "x" };
    expect(firstErrorField({}, values)).toBeNull();
    const errors: FieldErrors<BriefingFormValues> = {
      attendanceOverview: server,
      conflicts: [undefined, { text: server }],
    };
    expect(firstErrorField(errors, values)).toBe("attendanceOverview");
    expect(firstErrorField({ ...errors, feedbackSummary: server }, values)).toBe("feedbackSummary");
    expect(firstErrorField({ conflicts: [undefined, { text: server }] }, values)).toBe(
      "conflicts.1.text",
    );
  });
```

(`BriefingFormValues` is a type import from `./briefing-form-model`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/src/features/briefing/briefing-form-model.test.ts`
Expected: FAIL — `firstErrorField` is not exported.

- [ ] **Step 3: Implement it**

In `apps/web/src/features/briefing/briefing-form-model.ts`, add `import { type FieldErrors, get } from "react-hook-form";`
and, after `formFieldForApiField`:

```ts
/** The editor's fields in screen order: the summary card first, then each section's items. */
function fieldPaths(values: BriefingFormValues): BriefingFieldPath[] {
  return [
    "feedbackSummary",
    "attendanceOverview",
    ...LIST_SECTIONS.flatMap((section) =>
      values[section].map((_, index): BriefingFieldPath => `${section}.${index}.text`),
    ),
  ];
}

/** The first field with an error, so a save started from the read view can open on it. */
export function firstErrorField(
  errors: FieldErrors<BriefingFormValues>,
  values: BriefingFormValues,
): BriefingFieldPath | null {
  return (
    fieldPaths(values).find((path) => {
      const error: unknown = get(errors, path);
      return error !== undefined;
    }) ?? null
  );
}
```

Run: `pnpm vitest run apps/web/src/features/briefing/briefing-form-model.test.ts` — Expected: PASS.

- [ ] **Step 4: Write the failing editor tests**

In `apps/web/src/features/briefing/briefing-editor.test.tsx`, add imports
`import { focusManager } from "@tanstack/react-query";`, `act` from `@testing-library/react`, and
`import { expectReadItem, sectionItem, startEditing } from "../../testing/briefing-queries";`.
Add these tests to the `describe`:

```ts
  it("opens read-only; Edit briefing shows the text areas and focuses the feedback summary", async () => {
    const { user } = renderApp();
    const region = await panel();
    expect(region.queryAllByRole("textbox")).toHaveLength(0);
    expectReadItem(region, "Which themes recur", "Requests for more rest-break time.");
    await user.click(region.getByRole("button", { name: "Edit briefing" }));
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time.");
    await waitFor(() => {
      expect(document.activeElement).toBe(field(region, "Feedback summary"));
    });
    expect(region.getByRole("button", { name: "Save briefing" })).toBeTruthy();
    expect(region.getByRole("button", { name: "Cancel edit" })).toBeTruthy();
  });

  it("Cancel edit without changes closes the text areas at once and focuses the heading", async () => {
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    await user.click(region.getByRole("button", { name: "Cancel edit" }));
    expect(screen.queryByText("Discard your edits?")).toBeNull();
    expect(region.queryAllByRole("textbox")).toHaveLength(0);
    await expectEditorHeadingFocused(/^Generated preview/);
  });

  it("F5: a selected preview is saved from the read view, without editing", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(
      await region.findByRole("heading", { name: /^Saved briefing · last saved / }),
    ).toBeTruthy();
    expect(SaveBriefingRequestSchema.parse(api.saveRequests[0]).textEdits.themes).toEqual([
      "Requests for more rest-break time.",
    ]);
    // The saved briefing's read view offers Edit only: there is nothing unsaved to save.
    expect(region.queryByRole("button", { name: "Save briefing" })).toBeNull();
    expect(region.getByRole("button", { name: "Edit briefing" })).toBeTruthy();
  });

  it("Review Focus 1 / 2: a field error on a read-view save opens that field; Cancel edit closes it for good", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/briefing", () =>
        apiErrorResponse(
          422,
          "CONTENT_INVALID",
          "Text must be 1-1000 characters and not blank",
          "textEdits.conflicts.0",
        ),
      ),
    );
    const { user } = renderApp();
    const region = await panel();
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Text must be 1-1000 characters and not blank")).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(field(region, "Disagreement 1"));
    });
    await user.click(region.getByRole("button", { name: "Cancel edit" }));
    expect(region.queryAllByRole("textbox")).toHaveLength(0);
    expect(region.queryByText("Text must be 1-1000 characters and not blank")).toBeNull();
  });

  it("Review Focus 3: a clean open editor follows a newer saved revision back to the read view", async () => {
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    api.saveBriefingElsewhere();
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => {
      expect(region.queryAllByRole("textbox")).toHaveLength(0);
    });
    expect(region.getByRole("button", { name: "Edit briefing" })).toBeTruthy();
  });
```

Then update the existing tests in this file as follows (`startEditing(user, region)` goes on the
line after `const region = await panel();`; tests that never type are left as they are):

| Test | Change |
| --- | --- |
| F5-01 | Add `await startEditing(user, region);` after the evidence-limit assertion. After the saved heading, replace `expect(field(region, "Theme 1").value).toBe("People asked for longer rest breaks.");` and `expect(region.getByRole("button", { name: "Sources (8)" })).toBeTruthy();` with `expectReadItem(region, "Which themes recur", "People asked for longer rest breaks.");` and `expect(within(sectionItem(region, "Which themes recur")).getByText("F05")).toBeTruthy();` |
| Review Focus 5 / F5-05 | Add `startEditing`. Replace the `toggle` lookup with `const toggle = within(sectionItem(region, "Which themes recur")).getByRole("button", { name: "Sources (2)" });` and drop the `undefined` guard. |
| Review Focus 1 / F5-06; focus: a save that ends in a notice; focus: a Retry save that fails again; Spec 05 revision conflict; F5-04 blank item; F5-04 server field error; F5 saving state; F5 lost response: Check again | Add `startEditing` only. |
| F5-10 focus: Discard and reload | Add `startEditing`. Replace the `waitFor` on `field(region, "Theme 1").value` with `await waitFor(() => { expectReadItem(region, "Which themes recur", "Requests for more rest-break time."); });` |
| Spec 05 save failed: Retry save | Add `startEditing`. Replace the final `field(...).value` assertion with `expectReadItem(region, "Which themes recur", "Requests for more rest-break time. Again.");` |
| F5 lost response: the fields are locked… | Add `startEditing`. Replace `"Discard edits"` with `"Cancel edit"`. Replace the last two assertions with `expectReadItem(region, "Which themes recur", "Requests for more rest-break time. Landed.");` and `expect(isLocked(region.getByRole("button", { name: "Edit briefing" }))).toBe(false);` |
| F5-10: Discard edits asks first… | Rename to `"F5-10: Cancel edit with changes asks first; Cancel keeps the draft, Discard returns to the read view"`. Add `startEditing`; replace both `"Discard edits"` with `"Cancel edit"`; replace the final `waitFor` on the field value with `await waitFor(() => { expectReadItem(region, "Which themes recur", "Requests for more rest-break time."); });` |
| F5-10 focus: Discard after the server moved on | Add `startEditing`; `"Discard edits"` → `"Cancel edit"`; final `waitFor` → `expectReadItem(region, "Which themes recur", "Requests for more rest-break time.")` inside `waitFor`. |
| F5 lost response: one re-read confirms | Add `startEditing`; replace the final `field(...).value` assertion with `expectReadItem(region, "Which themes recur", "Requests for more rest-break time. Landed.");` |

- [ ] **Step 5: Update the panel tests**

In `apps/web/src/features/briefing/briefing-panel.test.tsx`, import
`{ expectReadItem, sectionItem, startEditing }` from `../../testing/briefing-queries`, and extend
`isLocked` with a native-disabled button branch:

```ts
const isLocked = (element: HTMLElement) =>
  (element instanceof HTMLTextAreaElement && element.disabled) ||
  (element instanceof HTMLButtonElement && element.disabled) ||
  element.getAttribute("aria-disabled") === "true";
```

| Test | Change |
| --- | --- |
| Review Focus 3 / F6-09 / F5-14 | `await startEditing(user, region);` before `const theme = …`. Replace the final `waitFor` on the Theme 1 value with `await waitFor(() => { expectReadItem(region, "Which themes recur", "Second preview theme."); });` |
| F4 step 7: the fields are locked while the automatic select is in flight | Rename to `"F4 step 7: an open clean editor is locked while the automatic select is in flight, then shows the new preview"`. Add `startEditing` before the first `isLocked`. Replace the `waitFor` on the Theme 1 value and the following `isLocked(...Theme 1)` line with `await waitFor(() => { expectReadItem(region, "Which themes recur", "Second preview theme."); });` and `expect(isLocked(region.getByRole("button", { name: "Edit briefing" }))).toBe(false);` |
| F4 step 7: an automatic select whose late response… | Replace the final `waitFor` and value assertion with `await waitFor(() => { expect(isLocked(region.getByRole("button", { name: "Edit briefing" }))).toBe(false); });` and `expectReadItem(region, "Which themes recur", "Selected in another tab.");` |
| F6-09: a preview another tab selected… | `startEditing` before typing. Final `waitFor` → `expectReadItem(region, "Which themes recur", "Second preview theme.")` inside `waitFor`. |
| F6 race 3 | `startEditing` before typing only. |
| Plan 4 review | `startEditing` before typing. Replace the final value assertion with `expectReadItem(region, "Which themes recur", "Requests for more rest-break time. Edited.");` |
| P22 | `startEditing` before typing; `"Discard edits"` → `"Cancel edit"`; final `waitFor` → `expectReadItem(region, "Which themes recur", "Requests for more rest-break time.")` inside `waitFor`. |
| switches the editor between the generated preview and the saved briefing | Replace each `expect(theme(region).value).toBe(TEXT);` with `expectReadItem(region, "Which themes recur", TEXT);` |
| F5-10: switching while dirty asks first | `startEditing` before typing. Replace the final `waitFor` on `theme(region).value` with `await waitFor(() => { expectReadItem(region, "Which themes recur", "Saved theme wording."); });` |
| F5 API contract | Replace the first `waitFor` with `await waitFor(() => { expectReadItem(region, "Which themes recur", "Saved theme wording."); });`, then add `await startEditing(user, region);` before `user.clear`. Replace the last `waitFor` with `await waitFor(() => { expectReadItem(region, "Which themes recur", "Edited saved wording."); });` |
| T3 §11 | Add `await startEditing(user, region);` before the first click. `themeToggle` returns `within(sectionItem(region, "Which themes recur")).getByRole("button", { name: "Sources (2)" })`. After the saved heading, replace the two assertions with: `const [row] = within(sectionItem(region, "Which themes recur")).getAllByRole("button");` `expect(row?.getAttribute("aria-expanded")).toBe("true");` `expect(region.getByRole("button", { name: "Sources (8)" }).getAttribute("aria-expanded")).toBe("false");` |

- [ ] **Step 6: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/src/features/briefing`
Expected: FAIL — no "Edit briefing" / "Cancel edit" buttons; the editor still shows text areas.

- [ ] **Step 7: Implement the read and edit views**

Replace the `BriefingEditor` function in `apps/web/src/features/briefing/briefing-editor.tsx` (keep
`TextField` and `NoticeBanner` as they are; add `firstErrorField` and `BriefingFieldPath` to the
`./briefing-form-model` import and
`import { BriefingContentView } from "./briefing-content-view";`):

```tsx
/** F5: edit the wording of one briefing; structure, references and provenance stay fixed. */
export function BriefingEditor({
  eventId,
  view,
  base,
  refetch,
  onSaved,
  onReset,
  consumePendingFocus,
  isLocked = false,
}: {
  eventId: EventId;
  view: EventView;
  base: EditorBase;
  refetch: RefetchEvent;
  /** The panel is replacing this base (an automatic select in flight): no new text meanwhile. */
  isLocked?: boolean;
  onSaved: (outcome: { reconciled: boolean }) => void;
  /** Just before an explicit discard or reload drops the draft: a remounted editor takes focus. */
  onReset: () => void;
  consumePendingFocus: () => boolean;
}) {
  const editor = useBriefingForm(eventId, base, refetch, onSaved, onReset);
  const [confirming, setConfirming] = useState<"discard" | "reload" | null>(null);
  // The briefing opens read-only (spec 2026-10-04); Edit briefing opens the text areas. Local state:
  // a remount (after a save, or a clean editor following the view) returns to the read view, and a
  // dirty draft never remounts, so typed text is never hidden or replaced without a choice.
  const [isEditing, setIsEditing] = useState(false);
  // The dialog is a native modal: while it is open the page is inert, and on close the browser
  // returns focus to the trigger, which a reset unmounts. Focus moves only once it has closed.
  // A request counter (not a boolean cleared in the effect): each request is handled once.
  const [focusAfterClose, setFocusAfterClose] = useState(0);
  const handledFocus = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  useEffect(() => {
    if (consumePendingFocus()) headingRef.current?.focus();
  }, [consumePendingFocus]);
  useEffect(() => {
    if (confirming !== null || focusAfterClose === handledFocus.current) return;
    handledFocus.current = focusAfterClose;
    headingRef.current?.focus();
  }, [confirming, focusAfterClose]);
  // F5: a save attempt that ended with a notice moves focus to it (field errors focus their field).
  const noticeRef = useRef<HTMLDivElement>(null);
  const handledNoticeFocus = useRef(0);
  useEffect(() => {
    if (editor.noticeFocusRequest === handledNoticeFocus.current) return;
    handledNoticeFocus.current = editor.noticeFocusRequest;
    noticeRef.current?.focus();
  }, [editor.noticeFocusRequest]);
  const requestFocusAfterClose = () => {
    setFocusAfterClose((count) => count + 1);
  };
  // A field to focus once the text areas are on screen: the first after Edit briefing, the failing
  // one after a field error. A request counter, like the others.
  const [fieldFocus, setFieldFocus] = useState<{ path: BriefingFieldPath; request: number } | null>(
    null,
  );
  const handledFieldFocus = useRef(0);
  useEffect(() => {
    if (fieldFocus === null || fieldFocus.request === handledFieldFocus.current) return;
    handledFieldFocus.current = fieldFocus.request;
    editor.form.setFocus(fieldFocus.path);
  }, [fieldFocus, editor.form]);
  const requestFieldFocus = (path: BriefingFieldPath) => {
    setFieldFocus((current) => ({ path, request: (current?.request ?? 0) + 1 }));
  };
  // A field error needs its field: a save started from the read view opens the editor on it.
  // Adjusted during render, React's pattern for state derived from props.
  const errorField = firstErrorField(editor.form.formState.errors, editor.form.getValues());
  if (errorField !== null && !isEditing) {
    setIsEditing(true);
    requestFieldFocus(errorField);
  }
  const startEditing = () => {
    setIsEditing(true);
    requestFieldFocus("feedbackSummary");
  };
  // Without changes Cancel edit just closes the text areas; with changes it asks first (F5-10).
  const cancelEditing = () => {
    if (editor.isDirty) {
      setConfirming("discard");
      return;
    }
    editor.form.clearErrors();
    setIsEditing(false);
    requestFocusAfterClose();
  };

  const { briefing } = base;
  const content = briefing.content;
  const scope = briefing.provenance.generationId;
  // Freshness follows the saved records even while the draft keeps its base (F5-12).
  const live =
    [view.selectedPreview, view.savedBriefing].find(
      (candidate) => candidate?.provenance.generationId === briefing.provenance.generationId,
    ) ?? briefing;
  const title =
    base.slot === "selected"
      ? "Generated preview — not saved as briefing"
      : briefing.savedAt === undefined
        ? "Saved briefing"
        : `Saved briefing · last saved ${formatTimestamp(briefing.savedAt)}`;
  const saveLabel =
    base.slot === "selected" && view.savedBriefing !== null
      ? "Save and replace briefing"
      : "Save briefing";
  const canSave = base.slot === "selected" || editor.isDirty;
  const control = editor.form.control;
  const fieldsDisabled = editor.areFieldsLocked || isLocked;
  const saveButton = (
    <Button
      type="submit"
      variant="primary"
      label={saveLabel}
      isDisabled={!canSave || editor.isBusy}
      isLoading={editor.isSaving}
    />
  );

  return (
    <article aria-labelledby={headingId}>
      <VStack gap={3}>
        <Heading level={3} id={headingId} ref={headingRef} tabIndex={-1}>
          {title}
        </Heading>
        <Text type="supporting">
          Generated {formatTimestamp(briefing.provenance.generatedAt)} · {briefing.provenance.model}{" "}
          · {briefing.trigger === "manual" ? "requested by you" : "automatic"}
        </Text>
        <FreshnessNotice briefing={live} members={view.members} counts={view.counts} />
        <Text type="supporting">{EVIDENCE_LIMIT_NOTICE}</Text>
        <form
          noValidate
          onSubmit={(event) => {
            void editor.submit(event);
          }}
        >
          <VStack gap={4}>
            {isEditing ? (
              <BriefingSectionsLayout
                summary={
                  <SummaryCard>
                    <TextField
                      control={control}
                      name="feedbackSummary"
                      label="Feedback summary"
                      isDisabled={fieldsDisabled}
                    />
                    <SourceDisclosure
                      sourceIds={content.feedbackSummary.sourceIds}
                      notes={view.feedback}
                      disclosureScope={`${scope}:feedbackSummary`}
                    />
                    <TextField
                      control={control}
                      name="attendanceOverview"
                      label="Attendance overview"
                      isDisabled={fieldsDisabled}
                    />
                    <VStack gap={0}>
                      <Text type="supporting">Check edited wording against the counts.</Text>
                      <Text type="supporting">
                        Generated from: {formatAttendanceCounts(briefing.provenance.input.counts)}
                      </Text>
                      <Text type="supporting">
                        Saved records now: {formatAttendanceCounts(view.counts)}
                      </Text>
                    </VStack>
                  </SummaryCard>
                }
                renderItems={(section) =>
                  content[section].map((item, index) => (
                    <VStack gap={1}>
                      <TextField
                        control={control}
                        name={`${section}.${index}.text`}
                        label={`${SECTION_COPY[section].itemLabel} ${String(index + 1)}`}
                        isDisabled={fieldsDisabled}
                      />
                      <SourceDisclosure
                        sourceIds={item.sourceIds}
                        notes={view.feedback}
                        disclosureScope={`${scope}:${section}.${String(index)}`}
                      />
                    </VStack>
                  ))
                }
              />
            ) : (
              <BriefingContentView content={content} notes={view.feedback} disclosureScope={scope} />
            )}
            <div role="status" aria-live="polite">
              {editor.isSaving ? (
                <Text>Saving briefing…</Text>
              ) : editor.isDirty ? (
                <Text>Unsaved changes to the briefing text.</Text>
              ) : null}
            </div>
            {editor.notice === null ? null : (
              <div ref={noticeRef} tabIndex={-1}>
                <NoticeBanner
                  notice={editor.notice}
                  isBusy={editor.isBusy}
                  onReload={() => {
                    setConfirming("reload");
                  }}
                  onRetry={() => {
                    void editor.submit();
                  }}
                  onCheckAgain={() => {
                    void editor.checkAgain();
                  }}
                />
              </div>
            )}
            {(editor.notice?.kind === "conflict" || editor.notice?.kind === "unavailable") &&
            view.savedBriefing !== null ? (
              // Spec 05 "Revision conflict": the current saved state, read-only, beside the kept draft.
              <BriefingPreview
                title="Latest saved briefing"
                briefing={view.savedBriefing}
                view={view}
              />
            ) : null}
            <HStack gap={2}>
              {isEditing ? (
                <>
                  {saveButton}
                  <Button
                    variant="secondary"
                    label="Cancel edit"
                    isDisabled={editor.isBusy}
                    onClick={cancelEditing}
                  />
                </>
              ) : (
                <>
                  {/* A selected preview can be saved as it is (spec 2026-10-04). */}
                  {base.slot === "selected" ? saveButton : null}
                  <Button
                    variant={base.slot === "selected" ? "secondary" : "primary"}
                    label="Edit briefing"
                    isDisabled={fieldsDisabled}
                    onClick={startEditing}
                  />
                </>
              )}
            </HStack>
          </VStack>
        </form>
      </VStack>
      <ConfirmDialog
        isOpen={confirming === "discard"}
        title="Discard your edits?"
        description="Your unsaved wording will be lost. The saved briefing does not change."
        actionLabel="Discard"
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          setConfirming(null);
          editor.discard();
          setIsEditing(false);
          requestFocusAfterClose();
        }}
      />
      <ConfirmDialog
        isOpen={confirming === "reload"}
        title="Reload the saved briefing?"
        description="Your unsaved wording will be discarded and replaced by the latest briefing."
        actionLabel="Discard and reload"
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          setConfirming(null);
          void editor.reloadLatest().then((reloaded) => {
            if (!reloaded) return;
            setIsEditing(false);
            requestFocusAfterClose();
          });
        }}
      />
    </article>
  );
}
```

This is the Task 4 Step 7 edit layout, now the `isEditing` branch; the disclosure scopes are
unchanged (`scope` is the generation ID), so a disclosure opened in one view is open in the other.

- [ ] **Step 8: Run the web tests**

Run: `pnpm vitest run --project web`
Expected: PASS.

- [ ] **Step 9: Verify and commit**

Run: `pnpm verify` — Expected: PASS.

```bash
git add -A apps/web/src
git commit -m "feat(web): briefing opens read-only; Edit briefing and Cancel edit (F5 amendment)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Dashboard shell and grid

**Files:**
- Create: `apps/web/src/features/event/event-dashboard-layout.tsx`
- Modify: `apps/web/src/features/event/event-header.tsx`
- Modify: `apps/web/src/features/event/event-page.tsx`
- Modify test: `apps/web/src/features/event/event-page.test.tsx`

**Interfaces:**
- Produces: `EventDashboardLayout({ heading, endContent, children }: { heading: ReactNode; endContent?: ReactNode; children: ReactNode })`;
  `DashboardGrid({ main, side }: { main: ReactNode; side: ReactNode })`.
- Produces: `EventHeader({ event }: { event: EventSummary })` (top-bar content) and
  `LiveStatus({ live }: { live: boolean })` from `event-header.tsx`.
- Consumes: `useEventChanges(eventId).live` (exists), `FakeEventSource.open()` / `.fail()` in tests (exist).

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/features/event/event-page.test.tsx`, add `within` and `waitFor` to the Testing
Library import and `import { FakeEventSource } from "../../testing/fake-event-source";`. Replace the
"orders the panels for reading…" test with:

```ts
  it("puts the briefing first, then attendance and feedback", async () => {
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Saturday Walk" });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Briefing", "Attendance", "Feedback"]);
  });

  it("is a dashboard: the event in the top bar, the three panels in the one main landmark", async () => {
    renderApp();
    const title = await screen.findByRole("heading", { level: 1, name: "Saturday Walk" });
    expect(title.closest("header")).not.toBeNull();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    const main = within(screen.getByRole("main"));
    for (const name of ["Briefing", "Attendance", "Feedback"]) {
      expect(main.getByRole("region", { name })).toBeTruthy();
    }
  });

  it("says in the top bar whether live updates are on; polling covers a closed stream", async () => {
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Saturday Walk" });
    expect(screen.getByText("Polling for updates")).toBeTruthy();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    act(() => {
      FakeEventSource.instances[0]?.open();
    });
    expect(await screen.findByText("Live updates")).toBeTruthy();
    act(() => {
      FakeEventSource.instances[0]?.fail();
    });
    expect(await screen.findByText("Polling for updates")).toBeTruthy();
  });
```

(If `title.closest("header")` is null because Astryx renders the banner as a `div role="banner"`,
use `title.closest("[role='banner'], header")` instead — check with the test, do not guess.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/src/features/event/event-page.test.tsx`
Expected: FAIL — headings are in the old order; no "Polling for updates".

- [ ] **Step 3: Write the layout**

Create `apps/web/src/features/event/event-dashboard-layout.tsx`:

```tsx
import { AppShell } from "@astryxdesign/core/AppShell";
import { TopNav } from "@astryxdesign/core/TopNav";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

const styles = stylex.create({
  content: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: 1440,
    marginInline: "auto",
    padding: "1.5rem",
  },
  grid: {
    display: "grid",
    gap: "1.5rem",
    alignItems: "start",
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      "@media (min-width: 900px)": "minmax(0, 2fr) minmax(0, 1fr)",
    },
  },
  column: { display: "flex", flexDirection: "column", gap: "1.5rem", minWidth: 0 },
});

/**
 * The coordinator dashboard (spec 2026-10-04): an Astryx app shell whose top bar names the event.
 * The shell owns the page's banner and main landmarks.
 */
export function EventDashboardLayout({
  heading,
  endContent,
  children,
}: {
  heading: ReactNode;
  endContent?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppShell topNav={<TopNav label="Event Desk" heading={heading} endContent={endContent} />}>
      <div {...stylex.props(styles.content)}>{children}</div>
    </AppShell>
  );
}

/** Briefing in the wide main column; attendance and feedback beside it, stacked below 900 px. */
export function DashboardGrid({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div {...stylex.props(styles.grid)}>
      <div {...stylex.props(styles.column)}>{main}</div>
      <div {...stylex.props(styles.column)}>{side}</div>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite the header for the top bar**

Replace the whole of `apps/web/src/features/event/event-header.tsx` with:

```tsx
import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { EventSummary } from "@event-desk/contracts";

/** The event, in the dashboard's top bar. */
export function EventHeader({ event }: { event: EventSummary }) {
  return (
    <HStack gap={2} align="center">
      <Heading level={1}>{event.name}</Heading>
      <Badge variant="neutral" label="Ended" />
      <Text type="supporting">{event.clubName}</Text>
    </HStack>
  );
}

/** F7: the change stream is open, or the page polls until it reconnects. */
export function LiveStatus({ live }: { live: boolean }) {
  return (
    <Badge
      variant={live ? "success" : "neutral"}
      label={live ? "Live updates" : "Polling for updates"}
    />
  );
}
```

- [ ] **Step 5: Rewrite the event screen**

In `apps/web/src/features/event/event-page.tsx`: remove the `stylex` import and `styles`; import
`Card` from `@astryxdesign/core/Card`, `Text` from `@astryxdesign/core/Text`,
`{ DashboardGrid, EventDashboardLayout }` from `./event-dashboard-layout` and
`{ EventHeader, LiveStatus }` from `./event-header`. Replace the body of `EventScreen` after the
`activeView` line with:

```tsx
  const appTitle = <Text weight="bold">Event Desk</Text>;
  if (query.isPending) {
    return (
      <EventDashboardLayout heading={appTitle}>
        <LoadingState label="Loading event…" />
      </EventDashboardLayout>
    );
  }
  if (query.isLoadingError) {
    if (query.error.code === "EVENT_NOT_FOUND") return <NotFoundPage title="Event not found" />;
    return (
      <EventDashboardLayout heading={appTitle}>
        <LoadErrorState
          title="The event could not be loaded"
          reason={describeApiError(query.error)}
          onRetry={() => void query.refetch()}
        />
      </EventDashboardLayout>
    );
  }

  const view = query.data;
  const displayed = displayedBriefing(view, activeView);
  return (
    <EventDashboardLayout
      heading={<EventHeader event={view.event} />}
      endContent={<LiveStatus live={live} />}
    >
      <VStack gap={4}>
        {query.isRefetchError ? (
          <Banner
            status="warning"
            title="Showing the last loaded data"
            description={`It could not be refreshed: ${describeApiError(query.error)}`}
          />
        ) : null}
        <DashboardGrid
          main={
            <Card padding={4}>
              <PanelErrorBoundary name="Briefing">
                <BriefingPanel eventId={eventId} view={view} refetch={query.refetch} />
              </PanelErrorBoundary>
            </Card>
          }
          side={
            <>
              <Card padding={4}>
                <PanelErrorBoundary name="Attendance">
                  <AttendancePanel eventId={eventId} view={view} refetch={query.refetch} />
                </PanelErrorBoundary>
              </Card>
              <Card padding={4}>
                <PanelErrorBoundary name="Feedback">
                  <FeedbackPanel
                    notes={view.feedback}
                    newSinceBriefing={new Set(displayed?.freshness.newFeedbackIds ?? [])}
                  />
                </PanelErrorBoundary>
              </Card>
            </>
          }
        />
      </VStack>
    </EventDashboardLayout>
  );
```

- [ ] **Step 6: Run the web tests**

Run: `pnpm vitest run --project web`
Expected: PASS.

- [ ] **Step 7: Check it in the browser (Review Focus 5)**

1. `pnpm infra:up`, then start the dev server with the browser preview tools (`preview_start` with
   the `pnpm dev` configuration in `.claude/launch.json`; create one with `runtimeExecutable: "pnpm"`,
   `runtimeArgs: ["dev"]`, `port: 5173` if it is missing). Open `http://localhost:5173/events/E101`.
2. Desktop width: the top bar shows the event, Ended, the club and the live badge; Briefing fills
   the left column with Generate on the right of its header; Attendance and Feedback are tables in
   the right column. Generate a briefing: the highlighted summary comes first, themes and
   disagreements sit side by side, follow-ups below; clicking a theme row reveals its notes.
3. Resize to 375 × 812 (`resize_window` preset `mobile`) and reload: one column in the order
   Briefing, Attendance, Feedback, and
   `document.documentElement.scrollWidth <= window.innerWidth` (run it with `javascript_tool`) is
   `true`. Add a long unbroken note through `/events/E101/feedback` (for example 120 × "a") and
   confirm it wraps inside the Feedback table at both widths.
4. If the h1 in the top bar is oversized or anything overflows, fix it with StyleX on our own
   elements (never by overriding Astryx internals), rerun the web tests, and recheck.
5. Take a desktop and a mobile screenshot for the final report; reset with preset `desktop`.

- [ ] **Step 8: Verify and commit**

Run: `pnpm verify` — Expected: PASS.

```bash
git add -A apps/web/src .claude/launch.json
git commit -m "feat(web): dashboard shell with the briefing first and a main/side grid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Leave `.claude/launch.json` out of `git add` if it already existed untracked before this plan —
check `git status` first; do not commit other files under `.claude/`.)

---

### Task 8: End-to-end walkthroughs and documentation

**Files:**
- Modify: `e2e/tests/f6-walkthrough.spec.ts`
- Modify: `e2e/tests/f7-feedback-batch.spec.ts`
- Modify: `docs/specs/02-attendance.md`, `docs/specs/03-feedback-and-sources.md`, `docs/specs/05-briefing-editor.md`, `docs/specs/README.md`, `README.md`

- [ ] **Step 1: Update the F6 walkthrough**

In `e2e/tests/f6-walkthrough.spec.ts`, replace the `themeItem` helper with:

```ts
// Theme 1 in the editor (read or edit view): the first item of the list named by its heading.
const themeItem = (briefing: Locator) =>
  briefing.getByRole("list", { name: "Which themes recur" }).first().locator(":scope > li").first();
const editBriefing = (briefing: Locator) =>
  briefing.getByRole("button", { name: "Edit briefing" }).click();
```

and replace the test body from the comment `// 2. Review Focus 5` to the end with:

```ts
  // 2. Review Focus 5: inspect F05/F06 by keyboard while editing; the draft survives; save.
  await editBriefing(briefing);
  const theme = briefing.getByLabel("Theme 1");
  await theme.fill("People asked for longer rest breaks.");
  const sources = themeItem(briefing).getByRole("button", { name: "Sources (2)" });
  await sources.focus();
  await page.keyboard.press("Enter");
  await expect(sources).toHaveAttribute("aria-expanded", "true");
  await expect(themeItem(briefing).getByText(F05)).toBeVisible();
  await expect(themeItem(briefing).getByText(F06)).toBeVisible();
  await expect(theme).toHaveValue("People asked for longer rest breaks.");
  await briefing.getByRole("button", { name: "Save briefing" }).click();
  await expect(
    briefing.getByRole("heading", { name: /^Saved briefing · last saved / }),
  ).toBeVisible();

  await page.reload(); // F5-02: the wording and its references survive a reload
  const savedRow = themeItem(briefing);
  await expect(savedRow.getByText("People asked for longer rest breaks.", { exact: true })).toBeVisible();
  await expect(savedRow.getByText("F05", { exact: true })).toBeVisible();
  await expect(savedRow.getByText("F06", { exact: true })).toBeVisible();

  // 3. An unsaved attendance change shows unsaved counts and a warning, and does not touch the
  // briefing.
  const overview = briefing.getByText(/^4 registered members: /).first();
  const originalOverview = (await overview.textContent()) ?? "";
  await attendance.getByRole("combobox", { name: "Chris" }).click();
  await attendance.getByRole("option", { name: "Attended" }).click();
  await expect(
    attendance.getByText("Unsaved counts: 4 registered · 2 attended · 2 absent · 0 not recorded"),
  ).toBeVisible();
  await expect(
    attendance.getByText(
      "Unsaved attendance changes. Save or discard them before generating a briefing.",
    ),
  ).toBeVisible();
  await expect(
    briefing.getByText("Up to date with the saved attendance and feedback."),
  ).toBeVisible();
  await expect(overview).toHaveText(originalOverview);

  // 4. Saving attendance marks the saved briefing out of date; wording and references stay.
  await attendance.getByRole("button", { name: "Save attendance" }).click();
  await expect(
    attendance.getByText("Saved counts: 4 registered · 2 attended · 2 absent · 0 not recorded"),
  ).toBeVisible();
  await expect(
    briefing.getByText("Out of date — attendance changed since this briefing was generated"),
  ).toBeVisible();
  await expect(briefing.getByText("Chris: Not recorded → Attended")).toBeVisible();
  await expect(
    themeItem(briefing).getByText("People asked for longer rest breaks.", { exact: true }),
  ).toBeVisible();
  // The original overview stays intact: saving attendance never rewrites briefing wording.
  await expect(overview).toHaveText(originalOverview);

  // 5. F6-12: saving edited wording keeps the stale flag, also after a reload.
  await editBriefing(briefing);
  await briefing.getByLabel("Theme 1").fill("Several people asked for longer rest breaks.");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && response.url().endsWith("/api/events/E101/briefing"),
  );
  await briefing.getByRole("button", { name: "Save briefing" }).click();
  expect((await saved).status()).toBe(200);
  await expect(briefing.getByText("Unsaved changes to the briefing text.")).toHaveCount(0);
  await page.reload();
  await expect(
    themeItem(briefing).getByText("Several people asked for longer rest breaks.", { exact: true }),
  ).toBeVisible();
  await expect(
    briefing.getByText("Out of date — attendance changed since this briefing was generated"),
  ).toBeVisible();

  // 6. F6-09: Generate with unsaved text; the result waits as incoming and the draft is untouched.
  await editBriefing(briefing);
  await briefing.getByLabel("Theme 1").fill("Draft that must survive generation.");
  await briefing.getByRole("button", { name: "Generate briefing" }).click();
  await expect(briefing.getByText("New briefing ready to review")).toBeVisible();
  await expect(briefing.getByLabel("Theme 1")).toHaveValue("Draft that must survive generation.");

  // 7. Review it (explicitly discarding the draft), inspect its sources, then Save and replace.
  await briefing.getByRole("button", { name: "Review new preview" }).click();
  await page.getByRole("button", { name: "Discard and review" }).click();
  await expect(
    briefing.getByRole("heading", { name: "Generated preview — not saved as briefing" }),
  ).toBeVisible();
  const previewTheme = "Requests for more rest-break time (interactive, 8 notes).";
  await expect(themeItem(briefing).getByText(previewTheme, { exact: true })).toBeVisible();
  // Spec 05: the saved briefing stays available beside the preview, through the switch; switching
  // away from unsaved preview text asks first (F5-10).
  const briefingToShow = briefing.getByRole("radiogroup", { name: "Briefing to show" });
  await editBriefing(briefing);
  await briefing.getByLabel("Theme 1").fill("Preview wording to discard.");
  await briefingToShow.getByRole("radio", { name: "Saved briefing" }).click();
  await page.getByRole("button", { name: "Discard and switch" }).click();
  await expect(
    briefing.getByRole("heading", { name: /^Saved briefing · last saved / }),
  ).toBeFocused();
  await expect(
    themeItem(briefing).getByText("Several people asked for longer rest breaks.", { exact: true }),
  ).toBeVisible();
  await briefingToShow.getByRole("radio", { name: "Generated preview" }).click();
  await expect(
    briefing.getByRole("heading", { name: "Generated preview — not saved as briefing" }),
  ).toBeFocused();
  await expect(themeItem(briefing).getByText(previewTheme, { exact: true })).toBeVisible();
  // Clicking the theme row reveals its notes (spec 2026-10-04).
  await themeItem(briefing).getByRole("button").first().click();
  await expect(themeItem(briefing).getByText(F05)).toBeVisible();
  await briefing.getByRole("button", { name: "Save and replace briefing" }).click();
  await expect(
    briefing.getByRole("heading", { name: /^Saved briefing · last saved / }),
  ).toBeVisible();
  await expect(
    briefing.getByText("Up to date with the saved attendance and feedback."),
  ).toBeVisible();
  await expect(themeItem(briefing).getByText(previewTheme, { exact: true })).toBeVisible();
});
```

- [ ] **Step 2: Update the F7 spec**

In `e2e/tests/f7-feedback-batch.spec.ts`, replace

```ts
  await expect(briefing.getByLabel("Theme 1")).toHaveValue(
    "Requests for more rest-break time (background, 11 notes).",
  );
```

with

```ts
  await expect(
    briefing
      .getByRole("list", { name: "Which themes recur" })
      .first()
      .locator(":scope > li")
      .first()
      .getByText("Requests for more rest-break time (background, 11 notes).", { exact: true }),
  ).toBeVisible();
```

and update the comment above the `Save briefing` count check to say the saved briefing is open in
its read view, which offers Edit briefing only.

- [ ] **Step 3: Run the end-to-end suite**

Run: `pnpm infra:up` (if not running), then `pnpm e2e`
Expected: both specs PASS. Do not run it alongside `pnpm test:integration`.

- [ ] **Step 4: Amend the specs (user-approved 2026-10-04)**

- `docs/specs/02-attendance.md`: append to the Status line
  `Amended 2026-10-04 (user-approved): attendance is a Name/Actions table with an Astryx Selector per member.`
  Replace the sentence "Use a labelled native select for each member as the compact interaction."
  with "Show the members in a table with **Name** and **Actions** columns; each Actions cell is a
  labelled Astryx Selector (Attended / Absent / Not recorded)."
- `docs/specs/03-feedback-and-sources.md`: append to the Status line
  `Amended 2026-10-04 (user-approved): one source disclosure per briefing item.` Replace the UI
  sentence "UI: accessible inline disclosure controls labelled, for example, **Read source F01**,
  with `aria-expanded` and a relationship to the revealed note." with "UI: one accessible inline
  disclosure per briefing item — the item's row in the read view, **Sources (n)** beside its text
  area while editing — with `aria-expanded` and a relationship to the revealed notes; it reveals
  every note the item cites, and the cited IDs stay visible next to the item's text."
- `docs/specs/05-briefing-editor.md`: append to the Status line
  `Amended 2026-10-04 (user-approved): read view first, Edit briefing and Cancel edit.` In step 1
  of "Editing flow", add: "The briefing opens in a read view — the highlighted feedback summary,
  themes and disagreements side by side, then follow-ups; **Edit briefing** opens the text areas,
  and a selected preview can also be saved from the read view." Replace "Display **Discard edits**
  when dirty; require explicit confirmation before losing local human changes." with "In the edit
  view, **Cancel edit** sits beside **Save briefing**: without changes it closes the text areas;
  with unsaved changes it requires explicit confirmation before losing them."
- `docs/specs/README.md`: in the success-measure row "Separate, anonymous and inspectable notes",
  replace "every cited ID opening its own source" with "every cited note inspectable from its
  item's source disclosure".
- `README.md`: in the "Review feedback" row, say the Feedback panel lists each note in a table
  with its stable ID; in the "Inspect and edit" row, replace "**Read source F05** opens the cited
  note inline. Edit the wording of any item" with "Click a theme, disagreement or follow-up row to
  read its cited notes inline. **Edit briefing** opens the wording of every item" and mention
  **Cancel edit**. Then run `grep -n "Read source\|native select\|Discard edits" README.md docs/specs/*.md`
  and update any remaining description of the old UI the same way (historical plans under
  `docs/superpowers/plans/` stay as they are).

- [ ] **Step 5: Verify and commit**

Run: `pnpm verify` — Expected: PASS (Prettier covers the Markdown).

```bash
git add e2e/tests docs/specs README.md
git commit -m "test(e2e): walkthroughs for the dashboard; docs: amend F2, F3, F5 for the dashboard UI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
