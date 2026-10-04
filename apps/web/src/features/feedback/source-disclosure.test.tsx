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
