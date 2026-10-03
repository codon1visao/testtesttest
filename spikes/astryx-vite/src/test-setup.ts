// jsdom does not implement window.matchMedia, which Astryx's useMediaQuery (used by Theme and
// Toast) calls on render. Report "no match" for every query and ignore change subscriptions.
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
