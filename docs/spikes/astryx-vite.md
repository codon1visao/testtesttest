# Spike: Astryx + StyleX on Vite 8 (T3 §15 step 1)

Date: 2026-10-03 · React 19.3.0 · Vite 8.3.2 · @vitejs/plugin-react 6.1.1 · Astryx 0.6.5 · StyleX 0.19.1 · Vitest 5.0.3 · jsdom 30.1.1

Five checks PASS. The dev-server row is PARTIAL: the server, the page and the transformed modules were verified with
`curl`; the in-browser check is pending the controller. Two findings need a decision or a workaround in `apps/web`
(a jsdom `matchMedia` stub, and a 10 s Vitest shutdown delay caused by StyleX's dev plugin); both are explained below.

| Check                                                                       | Result  | Notes                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install without peer conflicts                                              | PASS    | `@babel/core` 8.0.6 as listed; no peer warnings, so the 7.x fallback was not needed. The lockfile also holds 7.29.7 for transitive Babel plugins; no conflict.                                                                  |
| Vitest + jsdom renders Astryx components                                    | PASS    | 1 test passes. Needed one stub: jsdom has no `window.matchMedia`, which Astryx's `useMediaQuery` calls from `Theme` and `Toast`. See "Test setup".                                                                              |
| Toast via `useToast()` inside `LayerProvider`                               | PASS    | `ToastViewport` needed: no. `LayerProvider` hosts the toast on its own; "Attendance saved" is found by `findByText`.                                                                                                            |
| `vite build` emits StyleX CSS                                               | PASS    | 2160 modules, 0.7 s. Two CSS files: `astryx-stylex-*.css` 73,658 B (918 lines matching `x[a-z0-9]`, `@layer astryx-base`/`priority1..7`) and `index-*.css` 29,469 B (reset and theme). JS 528 kB (Vite chunk-size warning only). |
| Dev server renders and styles correctly                                     | PARTIAL | Verified with `curl` only (see "Dev server"). Rendering, styling, toast click and browser console: pending controller browser check.                                                                                            |
| `@event-desk/contracts` resolves through the `@event-desk/source` condition | PASS    | Vitest renders `Saturday Walk` from `SUPPLIED_EVENT`; the dev server serves `/@fs/.../packages/contracts/src/index.ts` (the source entry, not `dist`); `vite build` also succeeds.                                      |

## Test setup

`vitest.config.ts` merges `vite.config.ts` (so the same plugins and `resolve.conditions` apply) and adds
`environment: "jsdom"`, `include: ["src/**/*.test.tsx"]` and `setupFiles: ["./src/test-setup.ts"]`.

`src/test-setup.ts` defines `window.matchMedia` as "never matches, ignore subscriptions". Without it the first render
fails with `TypeError: window.matchMedia is not a function` (from `useMediaQuery.ts`, reached through `useTheme` in
`ToastSurface`). This is a jsdom gap, not an Astryx or Vite fault; Astryx documents no jsdom setup. `apps/web` copies the
same file.

The `import "./vite.config.ts"` in `vitest.config.ts` carries the file extension because Vite 8 warns that
`configLoader: 'native'` (the future default) needs it.

## Known issue: 10 s delay when Vitest exits

Every Vitest run ends with `close timed out after 10000ms … something prevents 2 Vite servers from exiting`. The tests
pass and the exit code is 0, but the run takes 10 s longer than it needs to. Cause, isolated by swapping plugins:
`astryxStylex()` alone reproduces it, `react()` alone does not. `@stylexjs/unplugin` 0.19.1 (`lib/vite.js`,
`configureServer`) starts a 150 ms `setInterval` and clears it only on the HTTP server's `close` event; Vitest's server
has no HTTP server, so the interval is never cleared. Nothing was patched here. Options for Plan 2: accept it, lower
`test.teardownTimeout`, or report it upstream to StyleX.

## Dev server

`pnpm --filter @event-desk/spike-astryx-vite dev` (port 5179), checked with `curl` and then stopped:

- `GET /` returns HTTP 200 with the page shell: the `@layer reset, astryx-base, astryx-theme, product;` declaration,
  the React refresh preamble, `/@id/virtual:stylex:runtime`, `/virtual:stylex.css` and `/src/main.tsx`. No error overlay.
- `GET /src/app.tsx` returns the transformed module (HTTP 200) importing Astryx from
  `@astryxdesign/core/src/...` (Astryx's alias to source) and `@event-desk/contracts` from
  `packages/contracts/src/index.ts`.
- `GET /src/main.tsx` returns HTTP 200 with the `reset.css` and `theme.css` imports resolved.
- `GET /virtual:stylex.css` returns the `@layer astryx-base` StyleX output. The server log shows no errors.

Not verified by the implementer (no browser available): the heading and the counts line on screen, the styled button,
the toast on click, and the browser console. Pending controller browser check.

## Recipe for apps/web (Plan 2)

- Dependencies and versions: `@astryxdesign/core` 0.6.5, `@astryxdesign/theme-neutral` 0.6.5, `@stylexjs/stylex` 0.19.1,
  `react` 19.3.0, `react-dom` 19.3.0, `@event-desk/contracts` `workspace:*`. Dev: `@astryxdesign/build` 0.6.5,
  `@babel/core` 8.0.6, `@stylexjs/babel-plugin` 0.19.1, `@stylexjs/unplugin` 0.19.1, `@testing-library/react` 16.3.3,
  `@types/react` 19.3.0, `@types/react-dom` 19.3.0, `@vitejs/plugin-react` 6.1.1, `jsdom` 30.1.1, `vite` 8.3.2
  (`vitest` 5.0.3 comes from the root).
- `vite.config.ts`: `plugins: [...astryxStylex(), react()]`; `resolve.conditions` is
  `["@event-desk/source", "module", "browser", "development|production"]`.
- Global CSS imports: `@astryxdesign/core/reset.css`, `@astryxdesign/theme-neutral/theme.css`
- Providers: `<Theme theme={neutralTheme}>` → `<LayerProvider>`; no `<ToastViewport>` is needed. Imports:
  `Theme` from `@astryxdesign/core/theme`, `neutralTheme` from `@astryxdesign/theme-neutral/built`, `LayerProvider` from
  `@astryxdesign/core/Layer`, `useToast` from `@astryxdesign/core/Toast`.
- Toast types available: `info` and `error` only, so success toasts use `info`. `useToast()` returns a function called as
  `showToast({ body })`.
- Tests: `jsdom` environment plus a setup file that stubs `window.matchMedia` (see "Test setup").
- Build output: StyleX rules land in a separate `astryx-stylex-*.css` that `vite build` links from `index.html`, next to
  the entry CSS.
- `pnpm-workspace.yaml`: `@astryxdesign/core` has a `postinstall` that only prints an `astryx init` hint, so it is set
  to `false` under `allowBuilds`.
