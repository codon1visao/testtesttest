import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeEventApi } from "./testing/fake-event-api";
import { mswServer } from "./testing/msw-server";
import { renderApp } from "./testing/render-app";

beforeEach(() => {
  mswServer.use(...new FakeEventApi().handlers());
});

describe("routes (T3 A14)", () => {
  it("redirects / to the seeded event", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Saturday Walk" })).toBeTruthy();
  });

  it("shows a not-found page for unknown paths", () => {
    renderApp("/nowhere");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
  });
});
