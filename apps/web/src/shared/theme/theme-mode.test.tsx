import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";
import { THEME_STORAGE_KEY } from "./theme-mode";

beforeEach(() => {
  mswServer.use(...new FakeEventApi().handlers());
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The mode Astryx applies: its Theme wrapper reflects it as data-theme. */
const appliedMode = () =>
  document.querySelector("div[data-astryx-theme]")?.getAttribute("data-theme") ?? null;
const themeSwitch = async () =>
  screen.findByRole("button", { name: /^Switch to (dark|light) theme$/ });
const shownIcon = (button: HTMLElement) =>
  button.querySelector("svg[data-icon]")?.getAttribute("data-icon") ?? null;

describe("theme mode", () => {
  it("starts light, not following the system setting", async () => {
    renderApp();
    const button = await themeSwitch();
    expect(appliedMode()).toBe("light");
    expect(button.getAttribute("aria-label") ?? button.textContent).toMatch(/Switch to dark theme/);
    expect(shownIcon(button)).toBe("moon");
  });

  it("the switch toggles dark and light at once, with its label and icon", async () => {
    const { user } = renderApp();
    await user.click(await themeSwitch());
    expect(appliedMode()).toBe("dark");
    const toLight = screen.getByRole("button", { name: "Switch to light theme" });
    expect(shownIcon(toLight)).toBe("sun");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    await user.click(toLight);
    expect(appliedMode()).toBe("light");
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeTruthy();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("remembers the choice in this browser: a fresh render restores it", async () => {
    const { user } = renderApp();
    await user.click(await themeSwitch());
    cleanup();
    renderApp();
    expect(await screen.findByRole("button", { name: "Switch to light theme" })).toBeTruthy();
    expect(appliedMode()).toBe("dark");
  });

  it("an invalid stored value falls back to light", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "purple");
    renderApp();
    await themeSwitch();
    expect(appliedMode()).toBe("light");
  });

  it("unavailable storage falls back to light, and the switch still works", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { user } = renderApp();
    await user.click(await themeSwitch());
    expect(appliedMode()).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeTruthy();
  });
});
