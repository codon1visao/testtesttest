import { FeedbackIdSchema } from "@event-desk/contracts";
import { FIXTURE_TIME } from "@event-desk/contracts/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { FakeEventSource } from "../../testing/fake-event-source";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";

let api: FakeEventApi;
let readsServed: number;
beforeEach(() => {
  api = new FakeEventApi();
  readsServed = 0;
  mswServer.use(...api.handlers());
  mswServer.events.on("response:mocked", ({ request }) => {
    if (request.method === "GET" && new URL(request.url).pathname === "/api/events/E101")
      readsServed++;
  });
});
afterEach(() => {
  mswServer.events.removeAllListeners();
});

/** Waits until the event read has been served this many times, so a refetch cannot swallow a later change. */
const settledAfterReads = async (count: number) => {
  await waitFor(() => {
    expect(readsServed).toBe(count);
  });
};

/** The first read has been served and rendered, so later changes to the fake API are genuinely new. */
const loadedFeedback = async () => within(await screen.findByRole("region", { name: "Feedback" }));

const stream = async () => {
  await waitFor(() => {
    expect(FakeEventSource.instances).toHaveLength(1);
  });
  const source = FakeEventSource.instances[0];
  if (source === undefined) throw new Error("no stream");
  return source;
};

describe("live updates (F7-15, F3-10)", () => {
  it("subscribes to the event's change stream and shows a note saved elsewhere without a reload", async () => {
    renderApp();
    const source = await stream();
    expect(source.url).toBe("/api/events/E101/changes");
    const panel = await loadedFeedback();
    expect(panel.queryByText("From the script.")).toBeNull();
    await settledAfterReads(1);
    api.view = {
      ...api.view,
      feedback: [
        ...api.view.feedback,
        { id: FeedbackIdSchema.parse("F09"), text: "From the script.", receivedAt: FIXTURE_TIME },
      ],
    };
    source.emit("changed", '{"version":3}');
    expect(await panel.findByText("From the script.")).toBeTruthy();
  });

  it("re-reads after the stream reconnects, in case changes were missed", async () => {
    renderApp();
    const source = await stream();
    const panel = await loadedFeedback();
    source.open(); // refetches once
    await settledAfterReads(2);
    source.fail();
    api.view = {
      ...api.view,
      feedback: [
        ...api.view.feedback,
        {
          id: FeedbackIdSchema.parse("F09"),
          text: "Missed while offline.",
          receivedAt: FIXTURE_TIME,
        },
      ],
    };
    expect(panel.queryByText("Missed while offline.")).toBeNull();
    source.open();
    expect(await panel.findByText("Missed while offline.")).toBeTruthy();
  });

  it("re-reads on the first open too, covering the gap between the first read and the stream", async () => {
    renderApp();
    const source = await stream();
    const panel = await loadedFeedback();
    api.view = {
      ...api.view,
      feedback: [
        ...api.view.feedback,
        {
          id: FeedbackIdSchema.parse("F09"),
          text: "Saved before the stream opened.",
          receivedAt: FIXTURE_TIME,
        },
      ],
    };
    expect(panel.queryByText("Saved before the stream opened.")).toBeNull();
    source.open();
    expect(await panel.findByText("Saved before the stream opened.")).toBeTruthy();
  });

  it("closes the stream when the page unmounts", async () => {
    const { unmount } = renderApp();
    const source = await stream();
    unmount();
    expect(source.readyState).toBe(2);
  });
});
