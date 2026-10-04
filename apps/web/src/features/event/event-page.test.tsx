import { focusManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { apiErrorResponse, FakeEventApi } from "../../testing/fake-event-api";
import { FakeEventSource } from "../../testing/fake-event-source";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";

let api: FakeEventApi;

beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

describe("event page", () => {
  it("F1: shows a labelled loading state, then the ended event", async () => {
    renderApp();
    expect(screen.getByText("Loading event…")).toBeTruthy();
    expect(screen.queryByText(/registered/)).toBeNull();
    expect(await screen.findByRole("heading", { level: 1, name: "Saturday Walk" })).toBeTruthy();
    expect(screen.getByText("Harbour Community Club")).toBeTruthy();
    expect(screen.getByText("Ended")).toBeTruthy();
  });

  it("puts the briefing first, then attendance and feedback", async () => {
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Saturday Walk" });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Briefing", "Attendance", "Feedback"]);
  });

  it("is a dashboard: the event in the top bar, the three panels in the one main landmark", async () => {
    renderApp();
    const title = await screen.findByRole("heading", { level: 1, name: "Saturday Walk" });
    // Astryx renders the top bar as <div role="banner">, not a <header> element.
    expect(title.closest("[role='banner']")).not.toBeNull();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    const main = within(screen.getByRole("main"));
    for (const name of ["Briefing", "Attendance", "Feedback"]) {
      expect(main.getByRole("region", { name })).toBeTruthy();
    }
  });

  it("says in the top bar whether live updates are on; polling covers a closed stream", async () => {
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Saturday Walk" });
    expect(screen.getByText("Polling for updates")).toBeTruthy();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    act(() => {
      FakeEventSource.instances[0]?.open();
    });
    expect(await screen.findByText("Live updates")).toBeTruthy();
    act(() => {
      FakeEventSource.instances[0]?.fail();
    });
    expect(await screen.findByText("Polling for updates")).toBeTruthy();
  });

  it("F1-08: shows an error with Retry when the API is unreachable, then recovers", async () => {
    mswServer.use(http.get("/api/events/:eventId", () => HttpResponse.error(), { once: true }));
    const { user } = renderApp();
    expect(await screen.findByText("The event could not be loaded")).toBeTruthy();
    expect(screen.getByText(/could not reach the event api/i)).toBeTruthy();
    expect(screen.queryByText(/registered/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Saturday Walk" })).toBeTruthy();
  });

  it("F1-08: explains a bare proxy 502 (API not running) as unreachable, with Retry", async () => {
    mswServer.use(
      http.get("/api/events/:eventId", () => new HttpResponse(null, { status: 502 }), {
        once: true,
      }),
    );
    const { user } = renderApp();
    expect(await screen.findByText("The event could not be loaded")).toBeTruthy();
    expect(screen.getByText(/could not reach the event api/i)).toBeTruthy();
    expect(screen.queryByText(/answered with status 502/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Saturday Walk" })).toBeTruthy();
  });

  it("treats a malformed response as a load error, not data", async () => {
    mswServer.use(
      http.get("/api/events/:eventId", () => HttpResponse.json({ event: { id: "E101" } })),
    );
    renderApp();
    expect(await screen.findByText("The event could not be loaded")).toBeTruthy();
    expect(screen.getByText(/unexpected response/i)).toBeTruthy();
  });

  it("F1-08: answers an unknown event with not found", async () => {
    renderApp("/events/E999");
    expect(await screen.findByRole("heading", { name: "Event not found" })).toBeTruthy();
  });

  it("shows the labelled loading state while a Retry is in flight", async () => {
    mswServer.use(http.get("/api/events/:eventId", () => HttpResponse.error(), { once: true }));
    const { user } = renderApp();
    expect(await screen.findByText("The event could not be loaded")).toBeTruthy();
    mswServer.use(
      http.get("/api/events/:eventId", async () => {
        await delay(150);
        return undefined;
      }),
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("status", { name: "Loading event…" })).toBeTruthy();
    expect(screen.queryByText("The event could not be loaded")).toBeNull();
    expect(await screen.findByRole("heading", { level: 1, name: "Saturday Walk" })).toBeTruthy();
  });

  it("does not call the API for a malformed event ID", async () => {
    const requested: string[] = [];
    mswServer.use(
      http.all("*", ({ request }) => {
        requested.push(request.url);
      }),
    );
    renderApp("/events/e101");
    expect(screen.getByRole("heading", { name: "Event not found" })).toBeTruthy();
    // Give any query a chance to start before asserting that none did.
    await act(() => delay(50));
    expect(requested).toEqual([]);
  });

  it("F1: keeps the last snapshot with a warning when a refresh fails", async () => {
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Saturday Walk" });
    mswServer.use(
      http.get("/api/events/:eventId", () =>
        apiErrorResponse(503, "STORE_UNAVAILABLE", "The event store is unavailable."),
      ),
    );
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByText("Showing the last loaded data")).toBeTruthy();
    expect(screen.getByText(/The event store is unavailable\./)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Saturday Walk" })).toBeTruthy();
  });
});
