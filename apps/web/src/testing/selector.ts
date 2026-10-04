import type { BoundFunctions, queries } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

type Queries = BoundFunctions<typeof queries>;

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
