import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { type BriefingContent, SUPPLIED_FEEDBACK } from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useUiStore } from "../../state/ui-store";
import { disclosedBy, expectReadItem, sectionItem } from "../../testing/briefing-queries";
import { EVIDENCE_NOTE } from "../feedback/source-disclosure";
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
  it("leads with the feedback summary before every list, and shows no attendance overview", () => {
    renderView();
    const summary = screen.getByText(CONTENT.feedbackSummary.text);
    const firstTheme = screen.getByText("Requests for more rest-break time.");
    expect(
      summary.compareDocumentPosition(firstTheme) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Spec 05 (amended 2026-10-04): the overview is generated and saved, but not shown.
    expect(screen.queryByText(CONTENT.attendanceOverview)).toBeNull();
  });

  it("shows no sources for the summary; its items keep theirs (spec 03, amended 2026-10-04)", () => {
    renderView();
    const summary = screen.getByRole("heading", { name: "Summary" }).parentElement;
    expect(summary === null ? [] : within(summary).queryAllByRole("button")).toHaveLength(0);
    expect(useUiStore.getState().openSources["g1:feedbackSummary"]).toBeUndefined();
    expect(within(sectionItem(screen, "Themes")).getAllByRole("button")).toHaveLength(1);
  });

  it("asks the brief's four questions in order: summary, themes, disagreements, suggestions", () => {
    renderView();
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual([
      "Summary",
      "Themes",
      "Disagreements",
      "Suggestions for you",
    ]);
    expectReadItem(
      screen,
      "Disagreements",
      "One note asks for an earlier start; another says it would be difficult.",
      1,
    );
    expectReadItem(screen, "Suggestions for you", "Consider reviewing the route length.", 1);
  });

  it("a row shows only the item text and expands to the cited notes, their IDs and the evidence note", async () => {
    const user = userEvent.setup();
    renderView();
    // The row's name is the wording alone: no "Sources" label and no ID badges in it.
    const row = within(sectionItem(screen, "Themes")).getByRole("button", {
      name: "Requests for more rest-break time.",
    });
    expect(within(row).queryByText("F05")).toBeNull();
    expect(within(row).queryByText("Sources")).toBeNull();
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await user.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    const notes = within(disclosedBy(row));
    expect(notes.getByText("F05")).toBeTruthy();
    expect(notes.getByText("F06")).toBeTruthy();
    expect(notes.getByText(NOTES[4]?.text ?? "")).toBeTruthy();
    expect(notes.getByText(EVIDENCE_NOTE)).toBeTruthy();
    expect(useUiStore.getState().openSources["g1:themes.0"]).toBe(true);
  });

  it("names the suggestion items and says when there are none", () => {
    renderView({ ...CONTENT, suggestions: [] });
    expect(screen.getByText("No suggestions.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Suggestions for you" })).toBeNull();
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
    expect(screen.queryByRole("list", { name: "Themes" })).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)"> **Check**')).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
