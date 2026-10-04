import { type BoundFunctions, type queries, screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { expect } from "vitest";

type Queries = BoundFunctions<typeof queries>;

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

/** What a disclosure trigger reveals: the element its aria-controls names. */
export function disclosedBy(trigger: HTMLElement): HTMLElement {
  const panel = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  if (panel === null) throw new Error("the trigger controls no element");
  return panel;
}

/**
 * The open confirmation dialog. Its Cancel shares a name with the briefing header's Cancel, so
 * dialog buttons are always looked up inside it.
 */
export async function confirmDialog(): Promise<Queries> {
  return within(await screen.findByRole("alertdialog"));
}

/** The briefing opens read-only (spec 2026-10-04): Edit in the header opens its text areas. */
export async function startEditing(user: UserEvent, scope: Queries): Promise<void> {
  await user.click(scope.getByRole("button", { name: "Edit" }));
  await scope.findByRole("button", { name: "Cancel" });
}
