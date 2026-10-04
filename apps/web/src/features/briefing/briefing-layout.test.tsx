import { SaveBriefingRequestSchema } from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { expectReadItem, startEditing } from "../../testing/briefing-queries";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";

let api: FakeEventApi;
const preview = buildBriefingView();

beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

const SECTION_CARDS = [
  ["themes", "Themes"],
  ["conflicts", "Disagreements"],
  ["suggestions", "Suggestions for you"],
] as const;

const landmark = async () => screen.findByRole("region", { name: "Briefing" });
/** The card holding the header, notices, switch, freshness and Summary. */
const briefingCard = (region: HTMLElement) => {
  const card = within(region)
    .getByRole("heading", { level: 2, name: "Briefing" })
    .closest<HTMLElement>("[data-briefing-card='briefing']");
  if (card === null) throw new Error("no Briefing card");
  return card;
};
const sectionCard = (region: HTMLElement, key: string) => {
  const card = region.querySelector<HTMLElement>(`[data-briefing-card='${key}']`);
  if (card === null) throw new Error(`no ${key} card`);
  return card;
};
/** Each section is its own card inside the landmark, outside the Briefing card. */
const expectSectionCards = (region: HTMLElement) => {
  const main = briefingCard(region);
  expect(within(main).getByRole("heading", { name: "Summary" })).toBeTruthy();
  for (const [key, title] of SECTION_CARDS) {
    const card = sectionCard(region, key);
    expect(main.contains(card)).toBe(false);
    expect(region.contains(card)).toBe(true);
    expect(within(card).getByRole("heading", { level: 4 }).textContent).toBe(title);
  }
};

describe("briefing layout: section cards below the Briefing card (spec 05, amended 2026-10-04)", () => {
  it("the read view puts Themes, Disagreements and Suggestions in their own cards", async () => {
    api.view = { ...api.view, selectedPreview: preview };
    renderApp();
    const region = await landmark();
    await within(region).findByRole("button", { name: "Edit" });
    expectSectionCards(region);
    expect(region.querySelectorAll("[data-briefing-card]")).toHaveLength(4);
    // The lists are still found by their section's name, inside their cards.
    expect(
      within(sectionCard(region, "themes")).getByRole("list", { name: "Themes" }),
    ).toBeTruthy();
    expectReadItem(within(region), "Themes", "Requests for more rest-break time.");
  });

  it("the edit view puts the text areas in the section cards, and Save sends the edited text", async () => {
    api.view = { ...api.view, selectedPreview: preview };
    const { user } = renderApp();
    const region = await landmark();
    await startEditing(user, within(region));
    expectSectionCards(region);
    for (const [key, label] of [
      ["themes", "Theme 1"],
      ["conflicts", "Disagreement 1"],
      ["suggestions", "Suggestion 1"],
    ] as const) {
      expect(within(sectionCard(region, key)).getByLabelText(label)).toBeTruthy();
    }
    expect(within(briefingCard(region)).getByLabelText("Feedback summary")).toBeTruthy();
    const theme = within(region).getByLabelText<HTMLTextAreaElement>("Theme 1");
    await user.clear(theme);
    await user.type(theme, "Edited in its card.");
    await user.click(within(region).getByRole("button", { name: "Save" }));
    expect(await within(region).findByRole("heading", { name: "Saved briefing" })).toBeTruthy();
    expect(SaveBriefingRequestSchema.parse(api.saveRequests[0]).textEdits.themes).toEqual([
      "Edited in its card.",
    ]);
    expectReadItem(within(region), "Themes", "Edited in its card.");
  });

  it("the unreviewed incoming preview, shown read-only without an editor, uses the cards too", async () => {
    api.view = { ...api.view, incomingPreview: preview };
    renderApp();
    const region = await landmark();
    await within(region).findByRole("heading", { name: "New preview (not yet reviewed)" });
    expectSectionCards(region);
  });

  it("the latest saved briefing shown during a conflict stays inline in the Briefing card", async () => {
    api.view = { ...api.view, selectedPreview: preview };
    const { user } = renderApp();
    const region = await landmark();
    await startEditing(user, within(region));
    api.view = { ...api.view, savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME } };
    api.saveBriefingElsewhere();
    await user.type(within(region).getByLabelText("Theme 1"), " Mine.");
    await user.click(within(region).getByRole("button", { name: "Save" }));
    const comparison = await within(region).findByRole("article", {
      name: "Latest saved briefing",
    });
    expect(briefingCard(region).contains(comparison)).toBe(true);
    expect(within(comparison).getByRole("list", { name: "Themes" })).toBeTruthy();
    // Only the editor's three section cards exist; the comparison has none of its own.
    expect(region.querySelectorAll("[data-briefing-card]")).toHaveLength(4);
  });
});
