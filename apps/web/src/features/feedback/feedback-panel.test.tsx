import { FeedbackIdSchema, SUPPLIED_FEEDBACK } from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";

let api: FakeEventApi;

beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

const panel = async () => within(await screen.findByRole("region", { name: "Feedback" }));

describe("feedback panel", () => {
  it("F3-01: lists the eight supplied notes, in ID order, with exact text", async () => {
    renderApp();
    const items = (await panel()).getAllByRole("listitem");
    expect(items.map((item) => within(item).getByText(/^F\d{2}$/).textContent)).toEqual(
      SUPPLIED_FEEDBACK.map((note) => note.id),
    );
    expect(items).toHaveLength(SUPPLIED_FEEDBACK.length);
    SUPPLIED_FEEDBACK.forEach((note, index) => {
      expect(items[index]?.textContent).toContain(note.text);
    });
  });

  it("says the notes are anonymous and read-only", async () => {
    renderApp();
    expect((await panel()).getByText(/anonymous/i)).toBeTruthy();
  });

  it("S1-13 / F3-07: renders markup in a note as inert text", async () => {
    api.view = {
      ...api.view,
      feedback: [
        ...api.view.feedback,
        {
          id: FeedbackIdSchema.parse("F09"),
          text: '<img src=x onerror="alert(1)"> **bold**',
          receivedAt: FIXTURE_TIME,
        },
      ],
    };
    renderApp();
    const region = await panel();
    expect(region.getByText('<img src=x onerror="alert(1)"> **bold**')).toBeTruthy();
    expect(region.queryByRole("img")).toBeNull();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  it("F6-18: notes outside the displayed briefing's input say so", async () => {
    const briefing = buildBriefingView({
      freshness: {
        current: false,
        attendanceChanges: [],
        newFeedbackIds: [FeedbackIdSchema.parse("F08")],
      },
    });
    api.view = { ...api.view, savedBriefing: briefing };
    renderApp();
    const items = (await panel()).getAllByRole("listitem");
    expect(within(items[7] ?? document.body).getByText("New since this briefing")).toBeTruthy();
    expect(within(items[0] ?? document.body).queryByText("New since this briefing")).toBeNull();
  });

  it("links to the test feedback form in a new tab", async () => {
    renderApp();
    const link = (await panel()).getByRole("link", { name: /Open feedback form \(test\)/ });
    expect(link.getAttribute("href")).toBe("/events/E101/feedback");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
