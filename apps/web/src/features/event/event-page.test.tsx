import { focusManager } from "@tanstack/react-query";
import { act, screen } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { apiErrorResponse, FakeEventApi } from "../../testing/fake-event-api";
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

  it("orders the panels for reading: attendance slot, feedback, briefing", async () => {
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Saturday Walk" });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Attendance", "Feedback", "Briefing"]);
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
