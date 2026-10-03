import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { mswServer } from "./msw-server";

// jsdom has no window.matchMedia; Astryx's useMediaQuery (Theme, Toast) calls it on render.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
beforeAll(() => {
  mswServer.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  cleanup();
  mswServer.resetHandlers();
});
afterAll(() => {
  mswServer.close();
});
