import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { FeedbackIdSchema, SUPPLIED_FEEDBACK } from "@event-desk/contracts";
import { FIXTURE_TIME } from "@event-desk/contracts/testing";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SourceReferences } from "./source-reference";

const NOTES = SUPPLIED_FEEDBACK.map((note) => ({ ...note, receivedAt: FIXTURE_TIME }));
const ids = (...raw: string[]) => raw.map((id) => FeedbackIdSchema.parse(id));

describe("SourceReferences (F3 inspection)", () => {
  it("Review Focus 5: a keyboard user opens a cited note inline and the toggle states it", async () => {
    const user = userEvent.setup();
    render(
      <Theme theme={neutralTheme}>
        <SourceReferences sourceIds={ids("F05", "F06")} notes={NOTES} />
      </Theme>,
    );
    const toggle = screen.getByRole("button", { name: "Read source F05" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.tab();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const controlled = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(controlled?.hidden).toBe(false);
    expect(controlled?.textContent).toContain(NOTES[4]?.text);
    expect(document.activeElement).toBe(toggle); // inspection never moves focus
    await user.keyboard("{Enter}");
    expect(controlled?.hidden).toBe(true);
  });

  it("F3: an ID missing from the event's notes is an error, never a note", () => {
    render(
      <Theme theme={neutralTheme}>
        <SourceReferences sourceIds={ids("F99")} notes={NOTES} />
      </Theme>,
    );
    expect(screen.getByText("Source F99 is unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Read source F99" })).toBeNull();
  });
});
