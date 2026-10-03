import { FeedbackIdSchema } from "@event-desk/contracts";
import { FIXTURE_TIME } from "@event-desk/contracts/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { FakeEventSource } from "../../testing/fake-event-source";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";

let api: FakeEventApi;
beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

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
    source.open();
    api.view = {
      ...api.view,
      feedback: [
        ...api.view.feedback,
        { id: FeedbackIdSchema.parse("F09"), text: "From the script.", receivedAt: FIXTURE_TIME },
      ],
    };
    source.emit("changed", '{"version":3}');
    const panel = within(await screen.findByRole("region", { name: "Feedback" }));
    expect(await panel.findByText("From the script.")).toBeTruthy();
  });

  it("re-reads after the stream reconnects, in case changes were missed", async () => {
    renderApp();
    const source = await stream();
    source.open();
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
    source.open();
    expect(await screen.findByText("Missed while offline.")).toBeTruthy();
  });

  it("closes the stream when the page unmounts", async () => {
    const { unmount } = renderApp();
    const source = await stream();
    unmount();
    expect(source.readyState).toBe(2);
  });
});
