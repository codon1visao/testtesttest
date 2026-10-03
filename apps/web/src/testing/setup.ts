import { focusManager } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { useUiStore } from "../state/ui-store";
import { FakeEventSource } from "./fake-event-source";
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

// jsdom does not implement window.scrollTo; Astryx's scroll lock (AlertDialog) restores scroll on close.
Object.defineProperty(window, "scrollTo", { writable: true, value: () => undefined });

// jsdom may lack <dialog> methods used by Astryx AlertDialog.
if (
  typeof HTMLDialogElement !== "undefined" &&
  typeof HTMLDialogElement.prototype.showModal !== "function"
) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
}

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
beforeAll(() => {
  mswServer.listen({ onUnhandledFrame: "error" });
  // jsdom has no EventSource; the change stream (F7) is driven by hand through the fake.
  Object.defineProperty(globalThis, "EventSource", {
    writable: true,
    configurable: true,
    value: FakeEventSource,
  });
});
afterEach(() => {
  cleanup();
  FakeEventSource.reset();
  // Tests simulate window focus to trigger refetches; hand focus tracking back to the browser default.
  focusManager.setFocused(undefined);
  useUiStore.setState({
    attendanceDirty: false,
    briefingDirty: false,
    activeView: "preview",
    openSources: {},
  });
  // Astryx announces toasts through document-level live regions that outlive cleanup(); clear them so
  // one test's announcement never satisfies the next test's query.
  for (const region of document.querySelectorAll("[data-astryx-live-region]"))
    region.textContent = "";
  mswServer.resetHandlers();
});
afterAll(() => {
  mswServer.close();
});
