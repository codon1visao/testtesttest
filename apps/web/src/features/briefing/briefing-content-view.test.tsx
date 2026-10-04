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
    expect(
      summary.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      overview.compareDocumentPosition(firstTheme) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("asks the brief's four questions in order: summary, themes, disagreements, follow-ups", () => {
    renderView();
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual([
      "What happened",
      "Which themes recur",
      "Where people disagree",
      "What might be worth following up",
    ]);
    expectReadItem(
      screen,
      "Where people disagree",
      "One note asks for an earlier start; another says it would be difficult.",
      1,
    );
    expectReadItem(
      screen,
      "What might be worth following up",
      "Consider reviewing the route length.",
      1,
    );
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
      suggestions: [
        {
          text: '<img src=x onerror="alert(1)"> **Check**',
          sourceIds: CONTENT.suggestions[1]?.sourceIds ?? [],
        },
      ],
    });
    expect(screen.getByText("No recurring themes identified.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Which themes recur" })).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)"> **Check**')).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
