import { type BoundFunctions, type queries, within } from "@testing-library/react";
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

/** The briefing opens read-only (spec 2026-10-04): Edit briefing opens its text areas. */
export async function startEditing(user: UserEvent, scope: Queries): Promise<void> {
  await user.click(scope.getByRole("button", { name: "Edit briefing" }));
  await scope.findByRole("button", { name: "Cancel edit" });
}
