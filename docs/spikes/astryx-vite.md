# Spike: Astryx + StyleX on Vite 8 (T3 §15 step 1)

Date: 2026-10-03 · React 19.3.0 · Vite 8.3.2 · @vitejs/plugin-react 6.1.1 · Astryx 0.6.5 · StyleX 0.19.1 · Vitest 5.0.3 · jsdom 30.1.1

All six checks PASS. The dev server was also checked in a browser by the controller (see "Dev server"). Two findings shape
the `apps/web` recipe: a jsdom `matchMedia` stub, and a Vitest-only plugin tweak that removes a 10 s shutdown delay
caused by StyleX's dev plugin.

| Check | Result | Notes |
| --- | --- | --- |
| Install without peer conflicts | PASS | `@babel/core` 8.0.6 as listed; no peer warnings, so the 7.x fallback was not needed. The lockfile also holds 7.29.7 for transitive Babel plugins; no conflict. |
| Vitest + jsdom renders Astryx components | PASS | 1 test passes. Needed one stub: jsdom has no `window.matchMedia`, which Astryx's `useMediaQuery` calls from `Theme` and `Toast`. See "Test setup". |
| Toast via `useToast()` inside `LayerProvider` | PASS | `ToastViewport` needed: no. `LayerProvider` hosts the toast on its own; "Attendance saved" is found by `findByText`, and the browser check shows it bottom-right in the top layer. |
| `vite build` emits StyleX CSS | PASS | `astryx-stylex-*.css` (73,658 B) holds `@layer astryx-base { @layer priority1..7 … }` with `.astryx…` atomic classes; the built `index.html` declares `@layer reset, astryx-base, astryx-theme, product;` and links both CSS files. The second file, `index-*.css` (29,469 B), is reset and theme. 2160 modules, 0.7 s; JS 528 kB (Vite chunk-size warning only). |
| Dev server renders and styles correctly | PASS | Browser-verified by the controller, plus curl checks by the implementer. See "Dev server". |
| `@event-desk/contracts` resolves through the `@event-desk/source` condition | PASS | The proof is the dev server serving `packages/contracts/src/index.ts` while a local `packages/contracts/dist` exists. The Vitest render alone does not prove it, because it could pass through `dist`. `vite build` also succeeds. |

## Test setup

`vitest.config.ts` merges `vite.config.ts` (the same plugins, minus the dev-only `configureServer` hook, and the same
`resolve.conditions`) and adds
`environment: "jsdom"`, `include: ["src/**/*.test.tsx"]` and `setupFiles: ["./src/test-setup.ts"]`.

`src/test-setup.ts` defines `window.matchMedia` as "never matches, ignore subscriptions". Without it the first render
fails with `TypeError: window.matchMedia is not a function` (from `useMediaQuery.ts`, reached through `useTheme` in
`ToastSurface`). This is a jsdom gap, not an Astryx or Vite fault; no jsdom setup was found in Astryx's packages or docs, and Astryx's
own tests stub `matchMedia` themselves (for example `node_modules/@astryxdesign/core/src/Selector/Selector.test.tsx`).
`apps/web` copies the same file.

The `import "./vite.config.ts"` in `vitest.config.ts` carries the file extension because Vite 8 warns that
`configLoader: 'native'` (the future default) needs it.

## Vitest shutdown delay (mitigated)

Without a mitigation every Vitest run ended with `close timed out after 10000ms … something prevents 2 Vite servers from
exiting`. The tests passed and the exit code was 0, but each run took about 12 s. Cause, isolated by swapping plugins:
`astryxStylex()` alone reproduces it, `react()` alone does not. `@stylexjs/unplugin` 0.19.1 (`lib/vite.js`,
`configureServer`) starts a 150 ms `setInterval` and clears it only on the HTTP server's `close` event; Vitest's server
has no HTTP server, so the interval is never cleared.

Verified mitigation (the preferred option; the `teardownTimeout` fallback was not needed): `vitest.config.ts` flattens
`viteConfig.plugins` and sets `configureServer: undefined` on every plugin before `mergeConfig`. StyleX transforms still
apply in tests: a temporary test asserted the rendered button has an `astryx…` class and passed (then was removed).
Result: `pnpm --filter @event-desk/spike-astryx-vite test` runs in 2.2 s wall time (vitest reports 1.7 s), 1 test passes,
and the "close timed out" warning no longer prints. `vite build` and the dev server use `vite.config.ts` and keep the hook.

## Dev server

`pnpm --filter @event-desk/spike-astryx-vite dev` (port 5179).

Browser-verified by the controller:

- Heading "Saturday Walk"; counts line "4 registered: 1 attended, 2 absent, 1 not recorded".
- The button is styled by StyleX (`astryx…` classes, 32 px tall) and the neutral dark theme applies.
- Clicking "Save attendance" shows the "Attendance saved" toast bottom-right in the top layer (popover), with a 1x1
  status live region; it auto-hides. No `ToastViewport` was needed.
- The console has no errors or warnings, only Vite connect and React DevTools info messages.

Secondary detail from the implementer's `curl` checks:

- `GET /` returns HTTP 200 with the page shell: the `@layer reset, astryx-base, astryx-theme, product;` declaration,
  the React refresh preamble, `/@id/virtual:stylex:runtime`, `/virtual:stylex.css` and `/src/main.tsx`. No error overlay.
- `GET /src/app.tsx` returns the transformed module (HTTP 200) importing Astryx from
  `@astryxdesign/core/src/...` (Astryx's alias to source) and `@event-desk/contracts` from
  `packages/contracts/src/index.ts`.
- `GET /src/main.tsx` returns HTTP 200 with the `reset.css` and `theme.css` imports resolved.
- `GET /virtual:stylex.css` returns the `@layer astryx-base` StyleX output. The server log shows no errors.

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
- Tests: `jsdom` environment plus a setup file that stubs `window.matchMedia` (see "Test setup"). In `vitest.config.ts`
  take the plugins from `vite.config.ts` and set `configureServer: undefined` on each, to avoid the 10 s shutdown delay
  (verified: see "Vitest shutdown delay (mitigated)").
- Build output: StyleX rules land in a separate `astryx-stylex-*.css` that `vite build` links from `index.html`, next to
  the entry CSS.
- `pnpm-workspace.yaml` `minimumReleaseAgeExclude`: pnpm added `@astryxdesign/build@0.6.5`, `@astryxdesign/core@0.6.5` and
  `@astryxdesign/theme-neutral@0.6.5` on install. They are pinned to exact versions, so bump them together with the
  Astryx versions, and prune them when the spike is removed (or when `apps/web` replaces them with its own entries).
- `pnpm-workspace.yaml` `allowBuilds`: `@astryxdesign/core` has a `postinstall` that only prints an `astryx init` hint, so it is set
  to `false` under `allowBuilds`.
