# Event Desk — Plan 2B: Coordinator Web Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/web`, the coordinator's event page on top of the Plan 2 API. It covers the event header and the attendance panel (F2: edit, unsaved counts, save, discard, conflicts, lost responses). It also covers the read-only feedback panel (F3) and a briefing panel placeholder, with loading and error states, one toast per mutation, and the web architecture rules.

**Architecture:** A Vite + React 19 SPA with two layers:
- **Data layer** (`src/data/`): an Axios client whose errors become one `ApiError` type, endpoint functions that validate every response against the contracts schemas, React Query hooks, and a `QueryClient` whose `MutationCache` applies the toast policy.
- **UI layer** (`src/features/`, `src/shared/`): Astryx components, React Hook Form for the attendance draft, and a Zustand store for cross-panel UI state only.

React Router v7 runs in declarative mode. The Vite dev proxy serves `/api` from the same origin, so the API's origin and host guards apply unchanged.

**Tech Stack:**
- Framework: React 19.3, Vite 8.3, React Router 7.18.4.
- Data and forms: TanStack Query 5.104, Axios 1.20, React Hook Form 7.89 with `@hookform/resolvers` 5.9, Zod 4 via `@event-desk/contracts`.
- UI: Zustand 5.0, Astryx 0.6.5 with StyleX 0.19.
- Tests: Vitest 5 with jsdom, Testing Library (`react` 16.3, `user-event` 14.6), MSW 3.0.

**Spec:** [docs/specs/README.md](../../specs/README.md) ("Screen and interaction", "Data ownership"), [F1](../../specs/01-event-and-persistence.md) (loading flow), [F2](../../specs/02-attendance.md) (coordinator flow, states, F2-01…F2-10), [F3](../../specs/03-feedback-and-sources.md) (reading flow, F3-01, F3-07, F3-08), [S1](../../specs/08-openai-security.md) (plain-text rendering), [T1](../../specs/10-frontend-technologies.md) (stack, layers, state ownership, mutation toasts), [T3 §11](../../specs/12-architecture-and-repository.md) (web layout and state table), plus [docs/spikes/astryx-vite.md](../../spikes/astryx-vite.md) (the verified Astryx recipe).

---

## Plan series

| Plan | Scope | Status |
| --- | --- | --- |
| 1 — Foundation | Workspace, contracts, Compose, CI, ADRs, spikes | Done |
| 2 — Event API core | Schema, seed/reset, cached event read, attendance save | Done |
| **2B — Coordinator web shell (this plan)** | `apps/web`: event page, attendance and feedback panels, data layer, toasts, routing | — |
| 3 — AI generation | tcp-rpc, ai-gateway, manual generation; the briefing panel's Generate flow replaces the placeholder | next |
| 4 — Review and save | F5/F6 editor, source disclosure (`source-reference.tsx`), Playwright walkthrough | — |
| 5 — Automatic batches | Feedback form route, BullMQ, SSE change stream and polling fallback | — |
| 6 — Hand-in | README | — |

Out of scope here:
- **The feedback form route** (`/events/:eventId/feedback`): it needs the Plan 5 endpoint.
- **SSE and the polling fallback:** Plan 5.
- **Source disclosure and "new since this briefing" markers:** these need briefings (Plan 4).
- **Generate controls:** Plan 3.

## Before you start

- Branch from `main`: `git switch -c feat/coordinator-web-shell main`.
- `pnpm infra:up` (MySQL and Redis healthy). `.env` exists at the repo root; if it doesn't, run `cp .env.example .env`.
- Read `AGENTS.md` and the recipe in `docs/spikes/astryx-vite.md`.

## Global Constraints

- **Earlier plans' constraints still apply:**
  - TypeScript strict, with no `any`, no non-null assertions and no string throws.
  - Exact version pins and kebab-case file names.
  - Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - In web code, imports are extensionless (`moduleResolution: "bundler"`, Vite convention); the Node apps keep `.js`.
- **Stack (T1/D10):**
  - React, TypeScript and Vite.
  - React Router v7 in declarative mode (`<BrowserRouter>` + `<Routes>`), with routes `/` → `/events/E101`, `/events/:eventId`, and `*` → not found. Data loading stays in React Query, never in router loaders.
  - Axios with React Query, Astryx, React Hook Form with Zod, and Zustand.
- **Layers (T1, T3 §11):**
  - The data layer (`src/data/`) holds no components.
  - Components never import Axios or endpoint functions; they use data-layer hooks. Task 2's dependency-cruiser rules enforce this.
- **State ownership (T3 §11):**
  - React Query owns the event aggregate.
  - React Hook Form owns the attendance draft. `reset()` runs only after a successful save, an explicit Discard, a conflict reload, or when the form is clean and newer saved data arrives (Task 7 ruling).
  - Zustand owns cross-panel UI flags only (`attendanceDirty`) and never copies server data.
- **Mutation feedback (T1):**
  - Every mutation shows exactly one toast, success or error, through one shared policy (the `MutationCache` in `createQueryClient`).
  - Success toasts use Astryx type `info`; failures use `error`.
  - Actionable errors also stay visible beside the form.
  - Neither Axios nor React Query retries automatically (`retry: false`); mutation requests are never replayed.
- **Attendance (F2):**
  - Three states, with labels "Attended", "Absent" and "Not recorded". Not recorded is never shown or counted as Absent.
  - Counts are derived in code, with `deriveAttendanceCounts`.
  - Explicit batch Save; no autosave.
  - The save sends the revision the draft was based on, never a newer one.
- **Feedback (F3/S1):**
  - Notes appear in API order (stable ID order).
  - Text is rendered as plain text through React. Never use `dangerouslySetInnerHTML` and never interpret Markdown.
- **Accessibility (README "Screen and interaction"):**
  - Labelled controls, keyboard access and visible focus.
  - State is conveyed in text, not colour alone.
  - Outcomes are announced without moving focus.
  - At narrow widths, panels stack in reading order: event, attendance, feedback, briefing.
- **Same origin:** the Vite proxy forwards `/api` to `http://127.0.0.1:4000`, so the API's `ALLOWED_ORIGINS=http://localhost:5173` and `ALLOWED_HOSTS` (`localhost`) apply unchanged. No CORS.
- **Dependencies.** Approving this plan approves exactly these:
  - `apps/web` dependencies:
    - `@astryxdesign/core` 0.6.5, `@astryxdesign/theme-neutral` 0.6.5, `@stylexjs/stylex` 0.19.1;
    - `react` 19.3.0, `react-dom` 19.3.0, `react-router` 7.18.4;
    - `@tanstack/react-query` 5.104.1, `axios` 1.20.0;
    - `react-hook-form` 7.89.0, `@hookform/resolvers` 5.9.1, `zod` 4.6.5, `zustand` 5.0.15;
    - `@event-desk/contracts` `workspace:*`.
  - `apps/web` devDependencies:
    - Astryx and StyleX build: `@astryxdesign/build` 0.6.5, `@babel/core` 8.0.6, `@stylexjs/babel-plugin` 0.19.1, `@stylexjs/unplugin` 0.19.1;
    - Testing: `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/user-event` 14.6.7, `jsdom` 30.1.1, `msw` 3.0.2;
    - Types and tooling: `@types/react` 19.3.0, `@types/react-dom` 19.3.0, `@vitejs/plugin-react` 6.1.1, `vite` 8.3.2.
  - Root devDependency: `eslint-plugin-react-hooks` 7.1.1.
  - All of these are T1/A13 libraries or their direct Testing Library and ESLint companions.
  - If pnpm 11 refuses a pinned version for release age, add an exact-version entry under the commented `minimumReleaseAgeExclude` block and report it. If it reports ignored build scripts, set the package to `false` under `allowBuilds` unless it cannot work without them, and report it.

## Review Focus

1. **Another tab saved attendance while this tab has unsaved edits.** This tab's later save must be rejected (409) with the draft kept. It must never silently overwrite the other save because the page picked up a newer revision. Pinned in Task 7 ("a refetch never overwrites a dirty draft, and its save still conflicts").
2. **The API is not running** (the proxy cannot connect) when the page first loads. Expect a clear error with Retry, never an empty roster or zero counts. Pinned in Task 5 ("shows an error with Retry when the API is unreachable").
3. **An API response that doesn't match the contract** (an older or changed API). Expect an error state, not a crash or half-rendered data. Pinned in Task 3 (`invalid-response`) and Task 5 ("treats a malformed response as a load error").
4. **Double-clicking Save attendance.** Expect exactly one PUT. Pinned in Task 7 ("sends one request for a double-clicked Save").
5. **A feedback note that contains HTML or a script tag.** Expect it shown as literal text with no element created. Pinned in Task 6.

---

## File structure

```text
apps/web/
├─ package.json · tsconfig.json · vite.config.ts · vitest.config.ts · index.html      # Task 1
└─ src/
   ├─ main.tsx                                  # Task 1
   ├─ app.tsx                                   # Task 1 (smoke), Task 5 (providers + routes)
   ├─ app-providers.tsx · routes.tsx · config.ts                                       # Task 5
   ├─ data/                                     # DATA LAYER — no components
   │  ├─ http/api-error.ts · http/api-client.ts                                        # Task 3
   │  ├─ api/event-api.ts                                                              # Task 3
   │  ├─ query-client.ts                                                               # Task 4
   │  ├─ queries/query-keys.ts · queries/use-event-query.ts                            # Task 4
   │  └─ mutations/attendance-cache.ts · mutations/use-save-attendance.ts              # Task 4
   ├─ state/ui-store.ts                                                                # Task 7
   ├─ features/
   │  ├─ event/event-page.tsx · event/event-header.tsx                                 # Task 5
   │  ├─ briefing/briefing-panel.tsx                                                   # Task 5 (placeholder)
   │  ├─ feedback/feedback-panel.tsx                                                   # Task 6
   │  └─ attendance/attendance-form-model.ts · use-attendance-form.ts
   │                · attendance-counts.tsx · attendance-panel.tsx                       # Task 7
   ├─ shared/
   │  ├─ ui/panel-error-boundary.tsx · ui/not-found-page.tsx · ui/page-states.tsx     # Task 5
   │  ├─ ui/confirm-dialog.tsx                                                         # Task 7
   │  └─ hooks/use-before-unload-warning.ts                                            # Task 7
   └─ testing/
      ├─ setup.ts                               # Task 1 (+ MSW in Task 3, dialog stub in Task 7)
      ├─ msw-server.ts · fake-event-api.ts      # Task 3
      └─ render-app.tsx                          # Task 5
```

Unit and component tests sit beside the code as `*.test.ts` or `*.test.tsx`. `src/testing/` holds test-only helpers. The root Vitest config picks up `apps/web/vitest.config.ts` through `projects: ["packages/*", "apps/*"]`.

---

### Task 1: Web app scaffold and tooling

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx`, `apps/web/src/app.tsx`, `apps/web/src/testing/setup.ts`
- Modify: root `package.json` (scripts `dev`, `build`, `typecheck`), `eslint.config.js` (react-hooks), root `package.json` devDependencies (`eslint-plugin-react-hooks`)
- Test: `apps/web/src/app.test.tsx`

**Interfaces:**
- Consumes: `@event-desk/contracts` through the `@event-desk/source` condition.
- Produces:
  - The `@event-desk/web` package.
  - Root scripts: `pnpm dev` runs the API and web together, `pnpm build` also builds the web bundle, and `pnpm typecheck` also type-checks web.
  - Test setup: the jsdom `matchMedia` stub and Testing Library cleanup.

- [ ] **Step 1: Create the package**

`apps/web/package.json`:

```json
{
  "name": "@event-desk/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@astryxdesign/core": "0.6.5",
    "@astryxdesign/theme-neutral": "0.6.5",
    "@event-desk/contracts": "workspace:*",
    "@hookform/resolvers": "5.9.1",
    "@stylexjs/stylex": "0.19.1",
    "@tanstack/react-query": "5.104.1",
    "axios": "1.20.0",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "react-hook-form": "7.89.0",
    "react-router": "7.18.4",
    "zod": "4.6.5",
    "zustand": "5.0.15"
  },
  "devDependencies": {
    "@astryxdesign/build": "0.6.5",
    "@babel/core": "8.0.6",
    "@stylexjs/babel-plugin": "0.19.1",
    "@stylexjs/unplugin": "0.19.1",
    "@testing-library/dom": "10.4.2",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.7",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "jsdom": "30.1.1",
    "msw": "3.0.2",
    "vite": "8.3.2"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": false,
    "declaration": false,
    "declarationMap": false,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`apps/web/vite.config.ts`. It uses the spike recipe, plus the dev server and the same-origin proxy:

```ts
import { astryxStylex } from "@astryxdesign/build/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [...astryxStylex(), react()],
  resolve: {
    conditions: ["@event-desk/source", "module", "browser", "development|production"],
  },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    // Same origin for the browser: the API's Origin/Host guards see http://localhost:5173 / localhost.
    proxy: { "/api": { target: "http://127.0.0.1:4000", changeOrigin: false } },
  },
});
```

`apps/web/vitest.config.ts`. It applies the verified mitigation from `docs/spikes/astryx-vite.md`:

```ts
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// @stylexjs/unplugin's dev-only `configureServer` hook starts an interval that only an HTTP server
// close clears; Vitest has none, so shutdown would stall 10 s. Tests keep the transforms, drop the hook.
const plugins = (viteConfig.plugins ?? [])
  .flat(Infinity)
  .map((plugin) =>
    typeof plugin === "object" && plugin !== null && "name" in plugin
      ? { ...plugin, configureServer: undefined }
      : plugin,
  );

export default mergeConfig(
  { ...viteConfig, plugins },
  defineConfig({
    test: {
      name: "web",
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["./src/testing/setup.ts"],
    },
  }),
);
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Event Desk</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Wire the workspace**

Root `package.json`:
- Add `"eslint-plugin-react-hooks": "7.1.1"` to `devDependencies`.
- Set these scripts. Keep every other script unchanged.

```json
"build": "tsc -b && pnpm --filter @event-desk/web build",
"typecheck": "tsc -b && tsc -p apps/web",
"dev": "pnpm --parallel --filter @event-desk/event-api --filter @event-desk/web dev",
```

`eslint.config.js`:
- Add `import reactHooks from "eslint-plugin-react-hooks";` after the other imports.
- Add this object after the `tseslint.configs.stylisticTypeChecked` entry:

```js
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
  },
```

Run: `pnpm install`
Expected: dependencies installed. Apply the Global Constraints rules for any release-age or build-script prompts.

- [ ] **Step 3: Write the failing test**

`apps/web/src/testing/setup.ts`:

```ts
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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
afterEach(() => {
  cleanup();
});
```

`apps/web/src/app.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "./app";

describe("App", () => {
  it("renders inside the Astryx theme", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Event Desk" })).toBeTruthy();
  });
});
```

Run: `pnpm test`
Expected: FAIL. `Failed to resolve import "./app"`.

- [ ] **Step 4: Implement the shell**

`apps/web/src/app.tsx` (Task 5 replaces the body):

```tsx
import { LayerProvider } from "@astryxdesign/core/Layer";
import { Heading } from "@astryxdesign/core/Text";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

export function App() {
  return (
    <Theme theme={neutralTheme}>
      <LayerProvider>
        <Heading level={1}>Event Desk</Heading>
      </LayerProvider>
    </Theme>
  );
}
```

`apps/web/src/main.tsx`:

```tsx
import "@astryxdesign/core/reset.css";
import "@astryxdesign/theme-neutral/theme.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 5: Run the tests and the tooling**

Run: `pnpm test`
Expected: PASS for the `web` project, and the run ends without the 10 s "close timed out" delay.

Run: `pnpm format && pnpm verify && pnpm build`
Expected: all exit 0. `pnpm arch` now also cruises `apps/web`.

If `not-to-unresolvable` reports a third-party import such as `@astryxdesign/core/Text` (its export map may need a condition dependency-cruiser does not pass), add the missing condition name, for example `"browser"`, to `options.enhancedResolveOptions.conditionNames` in `.dependency-cruiser.cjs`. Never disable the rule, and report the change.

- [ ] **Step 6: Commit**

```bash
git add apps/web package.json pnpm-lock.yaml pnpm-workspace.yaml eslint.config.js .dependency-cruiser.cjs
git commit -m "feat(web): scaffold the coordinator app with Astryx, Vite and Vitest" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Web architecture rules (with probes)

**Files:**
- Modify: `.dependency-cruiser.cjs`

**Interfaces:**
- Consumes: the existing `TESTS` constant, the `npm(names)` helper, and the existing web rules (`web-no-node`, `web-no-server-packages`, `apps-independent`).
- Produces: three rules that later tasks must keep green.
  - `web-ui-uses-data-layer`: UI code never imports Axios, the API client or endpoint functions.
  - `web-data-layer-has-no-ui`: the data layer never imports features, shared UI, state, Astryx or React Router.
  - `web-state-holds-no-server-data`: Zustand stores never import the data layer.

- [ ] **Step 1: Add the rules**

Append these objects to `forbidden` in `.dependency-cruiser.cjs`:

```js
    {
      name: "web-ui-uses-data-layer",
      comment: "Components use data-layer hooks; they never issue HTTP themselves (T1).",
      severity: "error",
      from: {
        path: "^apps/web/src/(features|shared|state)/|^apps/web/src/(app|routes|app-providers)\\.tsx$",
        pathNot: TESTS,
      },
      to: {
        path: [npm("axios"), "^apps/web/src/data/http/api-client\\.ts$", "^apps/web/src/data/api/"],
      },
    },
    {
      name: "web-data-layer-has-no-ui",
      comment: "The data layer holds no components, UI libraries or routing (T1, T3 §11).",
      severity: "error",
      from: { path: "^apps/web/src/data/", pathNot: TESTS },
      to: {
        path: ["^apps/web/src/(features|shared|state)/", npm("@astryxdesign/core|react-router")],
      },
    },
    {
      name: "web-state-holds-no-server-data",
      comment: "Zustand stores hold cross-panel UI state only; server data lives in React Query.",
      severity: "error",
      from: { path: "^apps/web/src/state/", pathNot: TESTS },
      to: { path: "^apps/web/src/data/" },
    },
```

Run: `pnpm arch`
Expected: no violations.

- [ ] **Step 2: Probe the new and the existing web rules**

Find the real path of an installed server package: `ls node_modules/.pnpm | grep '^ioredis@'` (e.g. `ioredis@5.11.1`). Create these temporary files. Each is a list of imports plus `export {};`.

| File | Imports | Must trigger |
| --- | --- | --- |
| `apps/web/src/data/api/probe-api.ts` | — | (target) |
| `apps/web/src/data/probe-data.ts` | `"../features/probe/probe-feature"`, `"@astryxdesign/core/Button"` | `web-data-layer-has-no-ui` (twice) |
| `apps/web/src/features/probe/probe-feature.tsx` | `"axios"`, `"../../data/api/probe-api"`, `"node:fs"`, `"../../../../../node_modules/.pnpm/<ioredis dir>/node_modules/ioredis/built/index.js"`, `"../../../../event-api/src/shared/app-error"` | `web-ui-uses-data-layer` (twice), `web-no-node`, `web-no-server-packages`, `apps-independent` |
| `apps/web/src/state/probe-state.ts` | `"../data/probe-data"` | `web-state-holds-no-server-data` |

Run: `pnpm arch`
Expected: FAIL, listing every rule named in the table, and possibly `no-circular` for `probe-data` ↔ `probe-feature`. Record the output in your report.

Delete exactly the probe files and any directories you created for them:

```bash
rm -r apps/web/src/data apps/web/src/features apps/web/src/state
```

Before running that, check with `git status --short apps/web/src` that those directories contain only your probe files. In this task they hold nothing else.

Run: `pnpm arch`
Expected: no violations. `git status --short` lists only `.dependency-cruiser.cjs`.

- [ ] **Step 3: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add .dependency-cruiser.cjs
git commit -m "chore(arch): enforce the web data/UI layering and probe the web rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: HTTP client, error model, endpoint functions and the MSW fake API

**Files:**
- Create: `apps/web/src/data/http/api-error.ts`, `apps/web/src/data/http/api-client.ts`, `apps/web/src/data/api/event-api.ts`
- Create: `apps/web/src/testing/msw-server.ts`, `apps/web/src/testing/fake-event-api.ts`
- Modify: `apps/web/src/testing/setup.ts` (MSW lifecycle)
- Test: `apps/web/src/data/http/api-error.test.ts`, `apps/web/src/data/api/event-api.test.ts`

**Interfaces:**
- Consumes: contracts `ApiErrorBodySchema`, `ErrorCode`, `EventId`, `EventIdSchema`, `EventView`, `EventViewSchema`, `SaveAttendanceRequest`, `SaveAttendanceRequestSchema`, `SaveAttendanceResponse`, `SaveAttendanceResponseSchema`, `deriveAttendanceCounts`; `buildSeedEventView` (contracts/testing).
- Produces:
  - **Error model:**
    - `ApiError` (`kind: "http" | "network" | "timeout" | "invalid-response"`, `status?`, `code?: ErrorCode`, `field?`, `retryAfterMs?`, and a getter `outcomeUnknown` that is true for network and timeout errors).
    - `describeApiError(error: unknown): string`.
    - `toApiError(error: unknown): ApiError`.
  - **HTTP client:** `apiClient` (an Axios instance with base URL `/api`, a 15 s timeout, and errors normalised to `ApiError`), plus `API_TIMEOUT_MS`.
  - **Endpoint functions:** `fetchEvent(eventId, signal): Promise<EventView>` and `saveAttendance(eventId, body): Promise<SaveAttendanceResponse>`. Both validate responses against the contracts.
  - **Test helpers:**
    - `mswServer` (`setupServer()`).
    - `FakeEventApi` (an in-memory API with `view`, `attendanceRequests`, `handlers()`, `saveElsewhere(memberId, attendance)`).
    - `apiErrorResponse(status, code, message)`.

- [ ] **Step 1: Write the MSW harness**

`apps/web/src/testing/msw-server.ts`:

```ts
import { setupServer } from "msw/node";

/** One MSW server for every web test; tests add handlers with `mswServer.use(...)`. */
export const mswServer = setupServer();
```

Append to `apps/web/src/testing/setup.ts`. Merge the imports into the existing ones: `afterAll` and `beforeAll` from `vitest`, and `mswServer` from `./msw-server`. Change the existing `afterEach` to also reset handlers:

```ts
beforeAll(() => {
  mswServer.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  cleanup();
  mswServer.resetHandlers();
});
afterAll(() => {
  mswServer.close();
});
```

After the edit the file has exactly one `afterEach`, the one above.

`apps/web/src/testing/fake-event-api.ts`:

```ts
import {
  type AttendanceStatus,
  deriveAttendanceCounts,
  type ErrorCode,
  type EventView,
  type MemberId,
  SaveAttendanceRequestSchema,
  type SaveAttendanceResponse,
} from "@event-desk/contracts";
import { buildSeedEventView } from "@event-desk/contracts/testing";
import { http, HttpResponse } from "msw";

export function apiErrorResponse(status: number, code: ErrorCode, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status });
}

/**
 * An in-memory stand-in for the Plan 2 API with the same contract and rules:
 * revision check (409), full-roster check (400), revision bump only on a real change.
 */
export class FakeEventApi {
  view: EventView = buildSeedEventView();
  readonly attendanceRequests: unknown[] = [];

  /** Simulates another tab saving: changes one member and bumps the revision. */
  saveElsewhere(memberId: MemberId, attendance: AttendanceStatus): void {
    const members = this.view.members.map((m) => (m.id === memberId ? { ...m, attendance } : m));
    this.view = {
      ...this.view,
      members,
      counts: deriveAttendanceCounts(members),
      attendanceRevision: this.view.attendanceRevision + 1,
    };
  }

  handlers() {
    return [
      http.get("/api/events/:eventId", ({ params }) =>
        params.eventId === this.view.event.id
          ? HttpResponse.json(this.view)
          : apiErrorResponse(404, "EVENT_NOT_FOUND", `Event ${String(params.eventId)} was not found.`),
      ),
      http.put("/api/events/:eventId/attendance", async ({ request }) => {
        const body: unknown = await request.json();
        this.attendanceRequests.push(body);
        const parsed = SaveAttendanceRequestSchema.safeParse(body);
        if (!parsed.success) return apiErrorResponse(400, "VALIDATION_FAILED", "Invalid attendance body.");
        if (parsed.data.baseAttendanceRevision !== this.view.attendanceRevision) {
          return apiErrorResponse(
            409,
            "ATTENDANCE_CONFLICT",
            "Attendance was saved elsewhere since you loaded it. Reload to see the latest records.",
          );
        }
        const requested = new Map(parsed.data.members.map((m) => [m.id, m.attendance]));
        if (requested.size !== this.view.members.length || this.view.members.some((m) => !requested.has(m.id))) {
          return apiErrorResponse(400, "VALIDATION_FAILED", "members must list each registered member exactly once.");
        }
        const members = this.view.members.map((m) => ({ ...m, attendance: requested.get(m.id) ?? m.attendance }));
        const changed = members.some((m, i) => m.attendance !== this.view.members[i]?.attendance);
        this.view = {
          ...this.view,
          members,
          counts: deriveAttendanceCounts(members),
          attendanceRevision: this.view.attendanceRevision + (changed ? 1 : 0),
        };
        const response: SaveAttendanceResponse = {
          members: this.view.members,
          counts: this.view.counts,
          attendanceRevision: this.view.attendanceRevision,
          freshness: { savedBriefing: null, selectedPreview: null, incomingPreview: null },
        };
        return HttpResponse.json(response);
      }),
    ];
  }
}
```

- [ ] **Step 2: Write the failing tests**

`apps/web/src/data/http/api-error.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiError, describeApiError } from "./api-error";

describe("ApiError", () => {
  it("marks network and timeout failures as an unknown outcome (the request may have landed)", () => {
    expect(new ApiError("network", "x").outcomeUnknown).toBe(true);
    expect(new ApiError("timeout", "x").outcomeUnknown).toBe(true);
    expect(new ApiError("http", "x", { status: 409, code: "ATTENDANCE_CONFLICT" }).outcomeUnknown).toBe(false);
  });
});

describe("describeApiError", () => {
  it("uses the API's own message for contract errors", () => {
    const error = new ApiError("http", "Attendance was saved elsewhere.", { status: 409, code: "ATTENDANCE_CONFLICT" });
    expect(describeApiError(error)).toBe("Attendance was saved elsewhere.");
  });

  it("explains transport failures in plain words", () => {
    expect(describeApiError(new ApiError("network", "x"))).toMatch(/could not reach the event api/i);
    expect(describeApiError(new ApiError("timeout", "x"))).toMatch(/took too long/i);
    expect(describeApiError(new ApiError("invalid-response", "x"))).toMatch(/unexpected response/i);
  });

  it("never shows raw non-API errors", () => {
    expect(describeApiError(new TypeError("cannot read properties of undefined"))).toBe("Something went wrong. Try again.");
  });
});
```

`apps/web/src/data/api/event-api.test.ts`:

```ts
import { EventIdSchema, MemberIdSchema, type SaveAttendanceRequest } from "@event-desk/contracts";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { ApiError } from "../http/api-error";
import { fetchEvent, saveAttendance } from "./event-api";

const E101 = EventIdSchema.parse("E101");
const signal = () => new AbortController().signal;
let api: FakeEventApi;

const failureOf = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
};

beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

describe("fetchEvent", () => {
  it("returns the contract-validated event view", async () => {
    const view = await fetchEvent(E101, signal());
    expect(view.event.name).toBe("Saturday Walk");
    expect(view.counts).toEqual({ registered: 4, attended: 1, absent: 2, notRecorded: 1 });
  });

  it("turns an API error body into an http ApiError with its code", async () => {
    const error = await failureOf(fetchEvent(EventIdSchema.parse("E999"), signal()));
    expect(error).toMatchObject({ kind: "http", status: 404, code: "EVENT_NOT_FOUND" });
  });

  it("rejects a response that breaks the contract as invalid-response", async () => {
    mswServer.use(http.get("/api/events/:eventId", () => HttpResponse.json({ event: { id: "E101" } })));
    expect(await failureOf(fetchEvent(E101, signal()))).toMatchObject({ kind: "invalid-response" });
  });

  it("reports an unreachable API as a network error", async () => {
    mswServer.use(http.get("/api/events/:eventId", () => HttpResponse.error()));
    expect(await failureOf(fetchEvent(E101, signal()))).toMatchObject({ kind: "network", outcomeUnknown: true });
  });

  it("reports a non-contract error body (e.g. a proxy 502 page) without a code", async () => {
    mswServer.use(http.get("/api/events/:eventId", () => new HttpResponse("<html>Bad gateway</html>", { status: 502 })));
    const error = await failureOf(fetchEvent(E101, signal()));
    expect(error).toMatchObject({ kind: "http", status: 502, code: undefined });
    expect(error.message).toBe("The event API answered with status 502.");
  });

  it("reports an aborted request as a network error", async () => {
    mswServer.use(
      http.get("/api/events/:eventId", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    const controller = new AbortController();
    const pending = failureOf(fetchEvent(E101, controller.signal));
    controller.abort();
    expect(await pending).toMatchObject({ kind: "network" });
  });
});

describe("saveAttendance", () => {
  const body = (base = 0): SaveAttendanceRequest => ({
    baseAttendanceRevision: base,
    members: api.view.members.map((m) => ({ id: m.id, attendance: m.id === "M03" ? "attended" : m.attendance })),
  });

  it("sends the body and returns the contract-validated response", async () => {
    const saved = await saveAttendance(E101, body());
    expect(saved.counts).toEqual({ registered: 4, attended: 2, absent: 2, notRecorded: 0 });
    expect(api.attendanceRequests).toEqual([body()]);
  });

  it("surfaces a conflict as http 409 ATTENDANCE_CONFLICT", async () => {
    api.saveElsewhere(MemberIdSchema.parse("M04"), "attended");
    expect(await failureOf(saveAttendance(E101, body(0)))).toMatchObject({
      kind: "http",
      status: 409,
      code: "ATTENDANCE_CONFLICT",
    });
  });
});
```

An aborted request is reported by Axios as a cancellation, so it surfaces as `network`. A real 15 s timeout is too slow for a unit test; `toApiError`'s timeout branch is pinned directly in Step 3.

- [ ] **Step 3: Add a direct timeout test**

Append to `apps/web/src/data/http/api-error.test.ts`:

```ts
import { AxiosError } from "axios";
import { toApiError } from "./api-client";

describe("toApiError", () => {
  it("maps an Axios timeout to kind timeout", () => {
    expect(toApiError(new AxiosError("timeout of 15000ms exceeded", "ECONNABORTED"))).toMatchObject({ kind: "timeout" });
    expect(toApiError(new AxiosError("timeout", "ETIMEDOUT"))).toMatchObject({ kind: "timeout" });
  });

  it("passes ApiErrors through and wraps anything else as network", () => {
    const original = new ApiError("http", "x", { status: 400 });
    expect(toApiError(original)).toBe(original);
    expect(toApiError(new Error("boom"))).toMatchObject({ kind: "network" });
  });
});
```

Move the two new imports to the top of the file with the others.

Run: `pnpm test`
Expected: FAIL. `Failed to resolve import "./api-error"`, `"./api-client"` and `"./event-api"`.

- [ ] **Step 4: Implement**

`apps/web/src/data/http/api-error.ts`:

```ts
import { assertNever, type ErrorCode } from "@event-desk/contracts";

export type ApiErrorKind = "http" | "network" | "timeout" | "invalid-response";

export interface ApiErrorDetails {
  status?: number;
  code?: ErrorCode;
  field?: string;
  retryAfterMs?: number;
  cause?: unknown;
}

/** Every failed API call surfaces as an ApiError; components never see Axios errors. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  readonly code: ErrorCode | undefined;
  readonly field: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(kind: ApiErrorKind, message: string, details: ApiErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "ApiError";
    this.kind = kind;
    this.status = details.status;
    this.code = details.code;
    this.field = details.field;
    this.retryAfterMs = details.retryAfterMs;
  }

  /** The request may have reached the server: reconcile with saved state before retrying (F2, F5). */
  get outcomeUnknown(): boolean {
    return this.kind === "network" || this.kind === "timeout";
  }
}

/** One plain sentence for the coordinator. API messages are authored, user-facing text. */
export function describeApiError(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Try again.";
  switch (error.kind) {
    case "http":
      return error.message;
    case "network":
      return "Could not reach the event API. Check that it is running, then try again.";
    case "timeout":
      return "The event API took too long to answer. Try again.";
    case "invalid-response":
      return "The event API sent an unexpected response. Reload the page; if it persists, the app and API may be out of step.";
    default:
      return assertNever(error.kind, "API error kind");
  }
}
```

`apps/web/src/data/http/api-client.ts`:

```ts
import { ApiErrorBodySchema } from "@event-desk/contracts";
import axios, { type AxiosInstance } from "axios";
import { ApiError } from "./api-error";

export const API_TIMEOUT_MS = 15_000;

/** Normalises any request failure into ApiError (T1: errors normalised, no toasts, no retries here). */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (!axios.isAxiosError(error)) return new ApiError("network", "The request failed.", { cause: error });
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
    return new ApiError("timeout", "The request timed out.", { cause: error });
  }
  const { response } = error;
  if (response === undefined) return new ApiError("network", "No response from the event API.", { cause: error });
  const body = ApiErrorBodySchema.safeParse(response.data);
  if (!body.success) {
    return new ApiError("http", `The event API answered with status ${response.status}.`, {
      status: response.status,
      cause: error,
    });
  }
  const { code, message, field, retryAfterMs } = body.data.error;
  return new ApiError("http", message, {
    status: response.status,
    code,
    ...(field === undefined ? {} : { field }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    cause: error,
  });
}

function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: "/api",
    timeout: API_TIMEOUT_MS,
    headers: { Accept: "application/json" },
  });
  client.interceptors.response.use(undefined, (error: unknown) => Promise.reject(toApiError(error)));
  return client;
}

export const apiClient = createApiClient();
```

`apps/web/src/data/api/event-api.ts`:

```ts
import {
  type EventId,
  type EventView,
  EventViewSchema,
  type SaveAttendanceRequest,
  type SaveAttendanceResponse,
  SaveAttendanceResponseSchema,
} from "@event-desk/contracts";
import type { z } from "zod";
import { apiClient } from "../http/api-client";
import { ApiError } from "../http/api-error";

/** Contract-first at the browser edge too: a response that breaks the contract is an error, not data. */
function parseResponse<Schema extends z.ZodType>(schema: Schema, data: unknown): z.output<Schema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError("invalid-response", "The event API sent an unexpected response.", { cause: result.error });
  }
  return result.data;
}

const eventPath = (eventId: EventId) => `/events/${encodeURIComponent(eventId)}`;

export async function fetchEvent(eventId: EventId, signal: AbortSignal): Promise<EventView> {
  const response = await apiClient.get<unknown>(eventPath(eventId), { signal });
  return parseResponse(EventViewSchema, response.data);
}

export async function saveAttendance(eventId: EventId, body: SaveAttendanceRequest): Promise<SaveAttendanceResponse> {
  const response = await apiClient.put<unknown>(`${eventPath(eventId)}/attendance`, body);
  return parseResponse(SaveAttendanceResponseSchema, response.data);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0, with `pnpm arch` clean.

```bash
git add apps/web/src
git commit -m "feat(web): typed HTTP client, ApiError model, contract-validated endpoints and MSW fake API" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Query and mutation hooks, cache merge and the toast policy

**Files:**
- Create: `apps/web/src/data/query-client.ts`, `apps/web/src/data/queries/query-keys.ts`, `apps/web/src/data/queries/use-event-query.ts`
- Create: `apps/web/src/data/mutations/attendance-cache.ts`, `apps/web/src/data/mutations/use-save-attendance.ts`
- Test: `apps/web/src/data/query-client.test.ts`, `apps/web/src/data/mutations/attendance-cache.test.ts`, `apps/web/src/data/mutations/use-save-attendance.test.tsx`

**Interfaces:**
- Consumes: `fetchEvent`, `saveAttendance`, `ApiError`, `describeApiError`, `FakeEventApi`, `mswServer` (Task 3); contracts types.
- Produces:
  - **Query client and toast policy** (`data/query-client.ts`):
    - `createQueryClient(notify: Notify): QueryClient` (queries and mutations `retry: false`; `MutationCache` toast policy).
    - Types `Notify = (toast: ToastMessage) => void` and `ToastMessage = { type: "info" | "error"; body: string }`.
    - `MutationToastMeta` (`successToast?`, `errorToast?`, `unknownOutcomeToast?`).
    - Module augmentation `Register { defaultError: ApiError; mutationMeta: MutationToastMeta }`.
  - **Queries:** `queryKeys.event(eventId)` and `useEventQuery(eventId)`.
  - **Mutations:**
    - `applyAttendanceSaved(view: EventView, saved: SaveAttendanceResponse): EventView`.
    - `useSaveAttendance(eventId)`: a mutation with `SaveAttendanceRequest` variables. On success it writes the response into the event cache, and on settle it invalidates the event query. Its toasts are "Attendance saved", "Attendance was not saved: …" and "Could not confirm the attendance save. Checking the saved records…".

- [ ] **Step 1: Write the failing tests**

`apps/web/src/data/query-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./http/api-error";
import { createQueryClient, type ToastMessage } from "./query-client";

function run(meta: object, outcome: "success" | ApiError) {
  const toasts: ToastMessage[] = [];
  const client = createQueryClient((toast) => toasts.push(toast));
  const mutation = client.getMutationCache().build(client, {
    mutationFn: () => (outcome === "success" ? Promise.resolve("ok") : Promise.reject(outcome)),
    meta,
  });
  return mutation.execute(undefined).then(
    () => toasts,
    () => toasts,
  );
}

describe("mutation toast policy (T1)", () => {
  it("shows exactly one success toast", async () => {
    expect(await run({ successToast: "Attendance saved" }, "success")).toEqual([
      { type: "info", body: "Attendance saved" },
    ]);
  });

  it("shows exactly one error toast with the reason", async () => {
    const error = new ApiError("http", "The event store is unavailable.", { status: 503, code: "STORE_UNAVAILABLE" });
    expect(await run({ errorToast: "Attendance was not saved" }, error)).toEqual([
      { type: "error", body: "Attendance was not saved: The event store is unavailable." },
    ]);
  });

  it("does not claim failure when the outcome is unknown", async () => {
    const meta = { errorToast: "Attendance was not saved", unknownOutcomeToast: "Could not confirm the save." };
    expect(await run(meta, new ApiError("network", "x"))).toEqual([{ type: "error", body: "Could not confirm the save." }]);
  });

  it("stays silent for mutations without toast metadata", async () => {
    expect(await run({}, "success")).toEqual([]);
  });
});
```

`apps/web/src/data/mutations/attendance-cache.test.ts`:

```ts
import { deriveAttendanceCounts, MemberIdSchema, type SaveAttendanceResponse } from "@event-desk/contracts";
import { buildBriefingView, buildSeedEventView } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import { applyAttendanceSaved } from "./attendance-cache";

describe("applyAttendanceSaved", () => {
  it("replaces members, counts, revision and each existing briefing's freshness", () => {
    const view = buildSeedEventView({ savedBriefing: buildBriefingView() });
    const members = view.members.map((m) => (m.id === "M03" ? { ...m, attendance: "attended" as const } : m));
    const stale = {
      current: false,
      attendanceChanges: [{ memberId: MemberIdSchema.parse("M03"), from: "not_recorded" as const, to: "attended" as const }],
      newFeedbackIds: [],
    };
    const saved: SaveAttendanceResponse = {
      members,
      counts: deriveAttendanceCounts(members),
      attendanceRevision: 1,
      freshness: { savedBriefing: stale, selectedPreview: null, incomingPreview: null },
    };
    const next = applyAttendanceSaved(view, saved);
    expect(next.members).toEqual(members);
    expect(next.counts).toEqual({ registered: 4, attended: 2, absent: 2, notRecorded: 0 });
    expect(next.attendanceRevision).toBe(1);
    expect(next.savedBriefing?.freshness).toEqual(stale);
    expect(next.savedBriefing?.content).toEqual(view.savedBriefing?.content);
    expect(next.feedback).toBe(view.feedback);
  });
});
```

`apps/web/src/data/mutations/use-save-attendance.test.tsx`:

```tsx
import { EventIdSchema, type EventView } from "@event-desk/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { createQueryClient, type ToastMessage } from "../query-client";
import { queryKeys } from "../queries/query-keys";
import { useSaveAttendance } from "./use-save-attendance";

const E101 = EventIdSchema.parse("E101");

describe("useSaveAttendance", () => {
  it("writes the saved records into the event cache and toasts once", async () => {
    const api = new FakeEventApi();
    mswServer.use(...api.handlers());
    const toasts: ToastMessage[] = [];
    const client = createQueryClient((toast) => toasts.push(toast));
    client.setQueryData<EventView>(queryKeys.event(E101), api.view);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSaveAttendance(E101), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        baseAttendanceRevision: 0,
        members: api.view.members.map((m) => ({ id: m.id, attendance: m.id === "M03" ? "attended" : m.attendance })),
      }),
    );
    await waitFor(() => {
      expect(client.getQueryData<EventView>(queryKeys.event(E101))?.attendanceRevision).toBe(1);
    });
    expect(toasts).toEqual([{ type: "info", body: "Attendance saved" }]);
  });
});
```

Run: `pnpm test`
Expected: FAIL. `Failed to resolve import "./query-client"`, `"./attendance-cache"` and `"./use-save-attendance"`.

- [ ] **Step 2: Implement**

`apps/web/src/data/query-client.ts`:

```ts
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { ApiError, describeApiError } from "./http/api-error";

export interface ToastMessage {
  type: "info" | "error";
  body: string;
}
export type Notify = (toast: ToastMessage) => void;

/** Per-mutation toast text; the policy below shows exactly one toast per settled mutation (T1). */
export interface MutationToastMeta extends Record<string, unknown> {
  successToast?: string;
  errorToast?: string;
  /** Shown instead of errorToast when the request may have landed (lost response). */
  unknownOutcomeToast?: string;
}

declare module "@tanstack/react-query" {
  interface Register {
    defaultError: ApiError;
    mutationMeta: MutationToastMeta;
  }
}

export function createQueryClient(notify: Notify): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        const body = mutation.meta?.successToast;
        if (body !== undefined) notify({ type: "info", body });
      },
      onError: (error, _variables, _context, mutation) => {
        const meta = mutation.meta;
        if (meta === undefined) return;
        // Register types errors as ApiError, but a bug can still throw anything: check, don't trust.
        if (error instanceof ApiError && error.outcomeUnknown && meta.unknownOutcomeToast !== undefined) {
          notify({ type: "error", body: meta.unknownOutcomeToast });
          return;
        }
        if (meta.errorToast !== undefined) notify({ type: "error", body: `${meta.errorToast}: ${describeApiError(error)}` });
      },
    }),
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}
```

`apps/web/src/data/queries/query-keys.ts`:

```ts
import type { EventId } from "@event-desk/contracts";

export const queryKeys = {
  event: (eventId: EventId) => ["event", eventId] as const,
};
```

`apps/web/src/data/queries/use-event-query.ts`:

```ts
import type { EventId } from "@event-desk/contracts";
import { useQuery } from "@tanstack/react-query";
import { fetchEvent } from "../api/event-api";
import { queryKeys } from "./query-keys";

/** The event aggregate: the single canonical copy of members, notes and briefings (F3 reference contract). */
export function useEventQuery(eventId: EventId) {
  return useQuery({
    queryKey: queryKeys.event(eventId),
    queryFn: ({ signal }) => fetchEvent(eventId, signal),
  });
}
```

`apps/web/src/data/mutations/attendance-cache.ts`:

```ts
import type { BriefingView, EventView, Freshness, SaveAttendanceResponse } from "@event-desk/contracts";

const withFreshness = (briefing: BriefingView | null, freshness: Freshness | null): BriefingView | null =>
  briefing === null || freshness === null ? briefing : { ...briefing, freshness };

/** Applies a successful attendance save to the cached view (members, counts, revision, briefing freshness). */
export function applyAttendanceSaved(view: EventView, saved: SaveAttendanceResponse): EventView {
  return {
    ...view,
    members: saved.members,
    counts: saved.counts,
    attendanceRevision: saved.attendanceRevision,
    savedBriefing: withFreshness(view.savedBriefing, saved.freshness.savedBriefing),
    selectedPreview: withFreshness(view.selectedPreview, saved.freshness.selectedPreview),
    incomingPreview: withFreshness(view.incomingPreview, saved.freshness.incomingPreview),
  };
}
```

`apps/web/src/data/mutations/use-save-attendance.ts`:

```ts
import type { EventId, EventView, SaveAttendanceRequest } from "@event-desk/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveAttendance } from "../api/event-api";
import { queryKeys } from "../queries/query-keys";
import { applyAttendanceSaved } from "./attendance-cache";

export function useSaveAttendance(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveAttendanceRequest) => saveAttendance(eventId, body),
    meta: {
      successToast: "Attendance saved",
      errorToast: "Attendance was not saved",
      unknownOutcomeToast: "Could not confirm the attendance save. Checking the saved records…",
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<EventView>(queryKeys.event(eventId), (view) =>
        view === undefined ? view : applyAttendanceSaved(view, saved),
      );
    },
    // Re-read the saved state after every outcome: a lost response may still have been saved (F2).
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) }),
  });
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/web/src
git commit -m "feat(web): event query, attendance mutation and the one-toast-per-mutation policy" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Providers, routes and the event page shell

**Files:**
- Create: `apps/web/src/app-providers.tsx`, `apps/web/src/routes.tsx`, `apps/web/src/config.ts`
- Create: `apps/web/src/features/event/event-page.tsx`, `apps/web/src/features/event/event-header.tsx`, `apps/web/src/features/briefing/briefing-panel.tsx`
- Create: `apps/web/src/shared/ui/panel-error-boundary.tsx`, `apps/web/src/shared/ui/not-found-page.tsx`, `apps/web/src/shared/ui/page-states.tsx`
- Create: `apps/web/src/testing/render-app.tsx`
- Modify: `apps/web/src/app.tsx` (providers + routes), `apps/web/src/app.test.tsx`
- Test: `apps/web/src/features/event/event-page.test.tsx`, `apps/web/src/shared/ui/panel-error-boundary.test.tsx`

**Interfaces:**
- Consumes: `createQueryClient`, `useEventQuery`, `describeApiError` and `ApiError` (Tasks 3–4); `FakeEventApi` and `mswServer`.
- Produces:
  - **App shell:** `AppProviders` (Theme → LayerProvider → QueryClientProvider, wired to Astryx toasts) and `AppRoutes`.
  - **Event page:** `EventPage`, and inside it `EventScreen({ eventId })`, which renders the header and the panels in reading order and leaves an `{/* attendance */}` slot for Task 7.
  - **Shared UI:** `PanelErrorBoundary({ name, children })`, `NotFoundPage`, `LoadingState` and `LoadErrorState`.
  - `BriefingPanel` (placeholder).
  - `EVENT_ID`.
  - Test helper `renderApp(route = "/events/E101"): { user, ...RenderResult }`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/testing/render-app.tsx`:

```tsx
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../app";

/** Renders the whole app (fresh providers and QueryClient) at a route, with a user-event session. */
export function renderApp(route = "/events/E101") {
  const user = userEvent.setup();
  return {
    user,
    ...render(
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>,
    ),
  };
}
```

Replace `apps/web/src/app.test.tsx` with:

```tsx
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
```

`apps/web/src/features/event/event-page.test.tsx`:

```tsx
import { focusManager } from "@tanstack/react-query";
import { act, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
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
    expect(headings).toEqual(["Briefing"]);
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

  it("treats a malformed response as a load error, not data", async () => {
    mswServer.use(http.get("/api/events/:eventId", () => HttpResponse.json({ event: { id: "E101" } })));
    renderApp();
    expect(await screen.findByText("The event could not be loaded")).toBeTruthy();
    expect(screen.getByText(/unexpected response/i)).toBeTruthy();
  });

  it("F1-08: answers an unknown event with not found", async () => {
    renderApp("/events/E999");
    expect(await screen.findByRole("heading", { name: "Event not found" })).toBeTruthy();
  });

  it("does not call the API for a malformed event ID", () => {
    renderApp("/events/e101");
    expect(screen.getByRole("heading", { name: "Event not found" })).toBeTruthy();
  });

  it("F1: keeps the last snapshot with a warning when a refresh fails", async () => {
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Saturday Walk" });
    mswServer.use(
      http.get("/api/events/:eventId", () => apiErrorResponse(503, "STORE_UNAVAILABLE", "The event store is unavailable.")),
    );
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByText("Showing the last loaded data")).toBeTruthy();
    expect(screen.getByText(/The event store is unavailable\./)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Saturday Walk" })).toBeTruthy();
    act(() => {
      focusManager.setFocused(undefined);
    });
  });
});
```

`apps/web/src/shared/ui/panel-error-boundary.test.tsx`:

```tsx
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelErrorBoundary } from "./panel-error-boundary";

function Broken(): never {
  throw new Error("render bug");
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined); // React logs caught render errors
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("PanelErrorBoundary", () => {
  it("contains a failing panel and keeps its siblings", () => {
    render(
      <Theme theme={neutralTheme}>
        <PanelErrorBoundary name="Feedback">
          <Broken />
        </PanelErrorBoundary>
        <p>Attendance still here</p>
      </Theme>,
    );
    expect(screen.getByText("Feedback could not be displayed")).toBeTruthy();
    expect(screen.getByText("Attendance still here")).toBeTruthy();
  });
});
```

Run: `pnpm test`
Expected: FAIL on the missing modules (`../app` routes, `./panel-error-boundary`).

- [ ] **Step 2: Implement the shared UI**

`apps/web/src/config.ts`:

```ts
/** The single seeded event this build serves (F1). */
export const EVENT_ID = "E101";
```

`apps/web/src/shared/ui/page-states.tsx`:

```tsx
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Spinner } from "@astryxdesign/core/Spinner";

/** Astryx Spinner renders its own role="status" element, named by the visible label. */
export function LoadingState({ label }: { label: string }) {
  return <Spinner label={label} />;
}

export function LoadErrorState({ title, reason, onRetry }: { title: string; reason: string; onRetry: () => void }) {
  return (
    <Banner
      status="error"
      title={title}
      description={reason}
      endContent={<Button label="Retry" variant="secondary" onClick={onRetry} />}
    />
  );
}
```

`apps/web/src/shared/ui/not-found-page.tsx`:

```tsx
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";

export function NotFoundPage({ title = "Page not found" }: { title?: string }) {
  return (
    <main>
      <EmptyState
        title={title}
        headingLevel={1}
        description="Check the address, or open the Saturday Walk event."
        actions={<Button label="Open the event" href="/" />}
      />
    </main>
  );
}
```

`apps/web/src/shared/ui/panel-error-boundary.tsx`:

```tsx
import { Banner } from "@astryxdesign/core/Banner";
import { Component, type ReactNode } from "react";

interface Props {
  name: string;
  children: ReactNode;
}

/** One failing panel never blanks the page (T3 §10: an error boundary per panel). */
export class PanelErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <Banner
          status="error"
          title={`${this.props.name} could not be displayed`}
          description="Reload the page to try again. Other panels are unaffected."
        />
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 3: Implement providers, routes and the page**

`apps/web/src/app-providers.tsx`:

```tsx
import { LayerProvider } from "@astryxdesign/core/Layer";
import { Theme } from "@astryxdesign/core/theme";
import { useToast } from "@astryxdesign/core/Toast";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createQueryClient } from "./data/query-client";

/** Owns the QueryClient and connects its toast policy to Astryx toasts (needs LayerProvider above). */
function QueryProvider({ children }: { children: ReactNode }) {
  const showToast = useToast();
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);
  const [queryClient] = useState(() =>
    createQueryClient((toast) => {
      showToastRef.current({ type: toast.type, body: toast.body });
    }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <Theme theme={neutralTheme}>
      <LayerProvider>
        <QueryProvider>{children}</QueryProvider>
      </LayerProvider>
    </Theme>
  );
}
```

`apps/web/src/routes.tsx`:

```tsx
import { Navigate, Route, Routes } from "react-router";
import { EVENT_ID } from "./config";
import { EventPage } from "./features/event/event-page";
import { NotFoundPage } from "./shared/ui/not-found-page";

/** React Router v7, declarative mode; data loading stays in React Query (T3 A14). */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/events/${EVENT_ID}`} replace />} />
      <Route path="/events/:eventId" element={<EventPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
```

Replace `apps/web/src/app.tsx` with:

```tsx
import { AppProviders } from "./app-providers";
import { AppRoutes } from "./routes";

export function App() {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  );
}
```

`apps/web/src/features/event/event-header.tsx`:

```tsx
import { Badge } from "@astryxdesign/core/Badge";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { EventSummary } from "@event-desk/contracts";

export function EventHeader({ event }: { event: EventSummary }) {
  return (
    <header>
      <VStack gap={1}>
        <HStack gap={2}>
          <Heading level={1}>{event.name}</Heading>
          <Badge variant="neutral" label="Ended" />
        </HStack>
        <Text type="supporting">{event.clubName}</Text>
      </VStack>
    </header>
  );
}
```

`apps/web/src/features/briefing/briefing-panel.tsx`:

```tsx
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading } from "@astryxdesign/core/Text";

/** Placeholder until Plan 3 adds generation and Plan 4 the editor. */
export function BriefingPanel() {
  return (
    <section aria-label="Briefing">
      <VStack gap={2}>
        <Heading level={2}>Briefing</Heading>
        <EmptyState isCompact headingLevel={3} title="No briefing yet" description="No briefing has been generated for this event yet." />
      </VStack>
    </section>
  );
}
```

`apps/web/src/features/event/event-page.tsx`:

```tsx
import { Banner } from "@astryxdesign/core/Banner";
import { VStack } from "@astryxdesign/core/Layout";
import { type EventId, EventIdSchema } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import { useParams } from "react-router";
import { describeApiError } from "../../data/http/api-error";
import { useEventQuery } from "../../data/queries/use-event-query";
import { NotFoundPage } from "../../shared/ui/not-found-page";
import { LoadErrorState, LoadingState } from "../../shared/ui/page-states";
import { PanelErrorBoundary } from "../../shared/ui/panel-error-boundary";
import { BriefingPanel } from "../briefing/briefing-panel";
import { EventHeader } from "./event-header";

const styles = stylex.create({
  page: { maxWidth: 960, marginInline: "auto", padding: "1.5rem" },
});

export function EventPage() {
  const { eventId = "" } = useParams();
  const parsed = EventIdSchema.safeParse(eventId);
  if (!parsed.success) return <NotFoundPage title="Event not found" />;
  return <EventScreen eventId={parsed.data} />;
}

export function EventScreen({ eventId }: { eventId: EventId }) {
  const query = useEventQuery(eventId);

  if (query.isPending) {
    return (
      <main {...stylex.props(styles.page)}>
        <LoadingState label="Loading event…" />
      </main>
    );
  }
  if (query.isLoadingError) {
    if (query.error.code === "EVENT_NOT_FOUND") return <NotFoundPage title="Event not found" />;
    return (
      <main {...stylex.props(styles.page)}>
        <LoadErrorState
          title="The event could not be loaded"
          reason={describeApiError(query.error)}
          onRetry={() => void query.refetch()}
        />
      </main>
    );
  }

  const view = query.data;
  return (
    <main {...stylex.props(styles.page)}>
      <VStack gap={6}>
        <EventHeader event={view.event} />
        {query.isRefetchError ? (
          <Banner
            status="warning"
            title="Showing the last loaded data"
            description={`It could not be refreshed: ${describeApiError(query.error)}`}
          />
        ) : null}
        {/* attendance: Task 7 */}
        {/* feedback: Task 6 */}
        <PanelErrorBoundary name="Briefing">
          <BriefingPanel />
        </PanelErrorBoundary>
      </VStack>
    </main>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/web/src
git commit -m "feat(web): providers, routes and the event page with loading, error and not-found states" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Feedback panel (F3, read-only)

**Files:**
- Create: `apps/web/src/features/feedback/feedback-panel.tsx`
- Modify: `apps/web/src/features/event/event-page.tsx` (render the panel), `apps/web/src/features/event/event-page.test.tsx` (heading order)
- Test: `apps/web/src/features/feedback/feedback-panel.test.tsx`

**Interfaces:**
- Consumes: `EventScreen` (Task 5), contracts `FeedbackNote`, `SUPPLIED_FEEDBACK`, and the testing helpers.
- Produces: `FeedbackPanel({ notes }: { notes: readonly FeedbackNote[] })`. Plan 4 adds source disclosure next to it.

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/feedback/feedback-panel.test.tsx`:

```tsx
import { FeedbackIdSchema, SUPPLIED_FEEDBACK } from "@event-desk/contracts";
import { FIXTURE_TIME } from "@event-desk/contracts/testing";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";

let api: FakeEventApi;

beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

const panel = async () => within(await screen.findByRole("region", { name: "Feedback" }));

describe("feedback panel", () => {
  it("F3-01: lists the eight supplied notes, in ID order, with exact text", async () => {
    renderApp();
    const items = (await panel()).getAllByRole("listitem");
    expect(items.map((item) => within(item).getByText(/^F\d{2}$/).textContent)).toEqual(
      SUPPLIED_FEEDBACK.map((note) => note.id),
    );
    expect(items.map((item) => item.textContent)).toEqual(
      SUPPLIED_FEEDBACK.map((note) => expect.stringContaining(note.text)),
    );
  });

  it("says the notes are anonymous and read-only", async () => {
    renderApp();
    expect((await panel()).getByText(/anonymous/i)).toBeTruthy();
  });

  it("S1-13 / F3-07: renders markup in a note as inert text", async () => {
    api.view = {
      ...api.view,
      feedback: [
        ...api.view.feedback,
        { id: FeedbackIdSchema.parse("F09"), text: '<img src=x onerror="alert(1)"> **bold**', receivedAt: FIXTURE_TIME },
      ],
    };
    renderApp();
    const region = await panel();
    expect(region.getByText('<img src=x onerror="alert(1)"> **bold**')).toBeTruthy();
    expect(region.queryByRole("img")).toBeNull();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
```

In `event-page.test.tsx`, change the expected level-2 headings in "orders the panels for reading" to `["Feedback", "Briefing"]`.

Run: `pnpm test`
Expected: FAIL. The region "Feedback" is not found.

- [ ] **Step 2: Implement**

`apps/web/src/features/feedback/feedback-panel.tsx`:

```tsx
import { Badge } from "@astryxdesign/core/Badge";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { FeedbackNote } from "@event-desk/contracts";

/**
 * Read-only notes in stable ID order (F3). Text is rendered as React text: markup and Markdown stay
 * inert (S1). Notes are anonymous and not linked to members.
 */
export function FeedbackPanel({ notes }: { notes: readonly FeedbackNote[] }) {
  return (
    <section aria-label="Feedback">
      <VStack gap={2}>
        <Heading level={2}>Feedback</Heading>
        <Text type="supporting">
          {notes.length} anonymous notes from the event feedback form. Read-only and not linked to members.
        </Text>
        {notes.length === 0 ? (
          <Text>No feedback notes yet.</Text>
        ) : (
          <ol>
            {notes.map((note) => (
              <li key={note.id}>
                <HStack gap={2}>
                  <Badge variant="neutral" label={note.id} />
                  <Text>{note.text}</Text>
                </HStack>
              </li>
            ))}
          </ol>
        )}
      </VStack>
    </section>
  );
}
```

In `event-page.tsx`:
- Import `FeedbackPanel`.
- Replace the `{/* feedback: Task 6 */}` line with:

```tsx
        <PanelErrorBoundary name="Feedback">
          <FeedbackPanel notes={view.feedback} />
        </PanelErrorBoundary>
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/web/src
git commit -m "feat(web): read-only feedback panel with inert note text" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Attendance panel (F2)

**Files:**
- Create: `apps/web/src/state/ui-store.ts`
- Create: `apps/web/src/shared/hooks/use-before-unload-warning.ts`, `apps/web/src/shared/ui/confirm-dialog.tsx`
- Create: `apps/web/src/features/attendance/attendance-form-model.ts`, `use-attendance-form.ts`, `attendance-counts.tsx`, `attendance-panel.tsx`
- Modify: `apps/web/src/features/event/event-page.tsx` (render the panel), `apps/web/src/features/event/event-page.test.tsx` (heading order), `apps/web/src/testing/setup.ts` (dialog stub, store reset)
- Test: `apps/web/src/features/attendance/attendance-form-model.test.ts`, `apps/web/src/features/attendance/attendance-panel.test.tsx`

**Interfaces:**
- Consumes: `useSaveAttendance`, `useEventQuery`'s `refetch`, `ApiError`, `describeApiError` (Tasks 3–5); contracts `ATTENDANCE_STATUSES`, `ATTENDANCE_LABELS`, `AttendanceStatusSchema`, `MemberIdSchema`, `deriveAttendanceCounts`, `EventView`, `Member`, `SaveAttendanceRequest`.
- Produces:
  - **UI store:** `useUiStore` (`attendanceDirty`, `setAttendanceDirty`). Plan 3's Generate button reads it.
  - **Shared helpers:** `useBeforeUnloadWarning(active: boolean)` and `ConfirmDialog`.
  - **Form model:** `AttendanceFormSchema`, `toFormValues(members)`, `toSaveRequest(values, baseRevision)`, `draftMatchesSaved(values, members)`.
  - **Hook:** `useAttendanceForm(eventId, view, refetch)`.
  - **Components:** `AttendanceCounts` and `AttendancePanel({ eventId, view, refetch })`.

**Ruling recorded in this plan (T3 §11 state table):** the table lists `reset()` "only after a successful save, explicit Discard, or conflict reload". This plan also resets a **clean** form when newer saved data arrives, for example from another tab or a refetch. A clean form holds no human work, and leaving it stale would make the next save conflict for no visible reason. A **dirty** form is never reset by data arriving. Its save uses the revision its draft was based on, so a newer server state produces a 409 and never a silent overwrite.

- [ ] **Step 1: Write the failing model tests**

`apps/web/src/features/attendance/attendance-form-model.test.ts`:

```ts
import { SUPPLIED_MEMBERS } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { draftMatchesSaved, toFormValues, toSaveRequest } from "./attendance-form-model";

describe("attendance form model", () => {
  it("turns saved members into form values and back into a save request", () => {
    const values = toFormValues(SUPPLIED_MEMBERS);
    expect(values.members).toEqual(SUPPLIED_MEMBERS.map((m) => ({ id: m.id, attendance: m.attendance })));
    expect(toSaveRequest(values, 3)).toEqual({
      baseAttendanceRevision: 3,
      members: SUPPLIED_MEMBERS.map((m) => ({ id: m.id, attendance: m.attendance })),
    });
  });

  it("knows when a draft equals the saved records, regardless of order", () => {
    const values = toFormValues(SUPPLIED_MEMBERS);
    expect(draftMatchesSaved(values, [...SUPPLIED_MEMBERS].reverse())).toBe(true);
    const changed = { members: values.members.map((m) => (m.id === "M03" ? { ...m, attendance: "attended" as const } : m)) };
    expect(draftMatchesSaved(changed, SUPPLIED_MEMBERS)).toBe(false);
  });
});
```

Run: `pnpm test`
Expected: FAIL. `Failed to resolve import "./attendance-form-model"`.

- [ ] **Step 2: Implement the model, store and shared helpers**

`apps/web/src/features/attendance/attendance-form-model.ts`:

```ts
import {
  AttendanceStatusSchema,
  type Member,
  MemberIdSchema,
  type SaveAttendanceRequest,
} from "@event-desk/contracts";
import { z } from "zod";

export const AttendanceFormSchema = z.object({
  members: z.array(z.object({ id: MemberIdSchema, attendance: AttendanceStatusSchema })),
});
export type AttendanceFormValues = z.input<typeof AttendanceFormSchema>;
export type AttendanceFormOutput = z.output<typeof AttendanceFormSchema>;

export function toFormValues(members: readonly Pick<Member, "id" | "attendance">[]): AttendanceFormValues {
  return { members: members.map((m) => ({ id: m.id, attendance: m.attendance })) };
}

export function toSaveRequest(values: AttendanceFormOutput, baseAttendanceRevision: number): SaveAttendanceRequest {
  return { baseAttendanceRevision, members: values.members.map((m) => ({ id: m.id, attendance: m.attendance })) };
}

/** After a lost response: did the server already save exactly this draft? */
export function draftMatchesSaved(values: AttendanceFormValues, saved: readonly Pick<Member, "id" | "attendance">[]): boolean {
  const savedById = new Map(saved.map((m) => [m.id as string, m.attendance]));
  return values.members.length === saved.length && values.members.every((m) => savedById.get(m.id) === m.attendance);
}
```

`apps/web/src/state/ui-store.ts`:

```ts
import { create } from "zustand";

/** Cross-panel UI state only — never server data (T1, T3 §11). */
interface UiState {
  attendanceDirty: boolean;
  setAttendanceDirty: (dirty: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  attendanceDirty: false,
  setAttendanceDirty: (attendanceDirty) => {
    set({ attendanceDirty });
  },
}));
```

`apps/web/src/shared/hooks/use-before-unload-warning.ts`:

```ts
import { useEffect } from "react";

/** Asks the browser to warn before leaving while unsaved work exists (F2, F5; best effort). */
export function useBeforeUnloadWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [active]);
}
```

`apps/web/src/shared/ui/confirm-dialog.tsx`:

```tsx
import { AlertDialog } from "@astryxdesign/core/AlertDialog";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  actionLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Explicit confirmation before losing human work (F2 conflict reload, F5 discard). */
export function ConfirmDialog({ isOpen, title, description, actionLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <AlertDialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={title}
      description={description}
      cancelLabel="Cancel"
      actionLabel={actionLabel}
      actionVariant="destructive"
      onAction={onConfirm}
    />
  );
}
```

Append to `apps/web/src/testing/setup.ts`, merging the import of `useUiStore` from `../state/ui-store` into the existing imports:

```ts
// jsdom may lack <dialog> methods used by Astryx AlertDialog.
if (typeof HTMLDialogElement !== "undefined" && typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
}
```

In the existing `afterEach`, add `useUiStore.setState({ attendanceDirty: false });` after `cleanup()`.

Run: `pnpm test`
Expected: the model tests PASS.

- [ ] **Step 3: Write the failing panel tests**

`apps/web/src/features/attendance/attendance-panel.test.tsx`:

```tsx
import { MemberIdSchema } from "@event-desk/contracts";
import { focusManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../../state/ui-store";
import { apiErrorResponse, FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";

const M03 = MemberIdSchema.parse("M03");
const M04 = MemberIdSchema.parse("M04");
let api: FakeEventApi;

beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

const panel = async () => within(await screen.findByRole("region", { name: "Attendance" }));
const select = (region: Awaited<ReturnType<typeof panel>>, name: string) =>
  region.getByRole<HTMLSelectElement>("combobox", { name });
const refocus = () => {
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
};

describe("attendance panel", () => {
  it("F2-01: shows each member's saved status and the saved counts", async () => {
    renderApp();
    const region = await panel();
    expect(select(region, "Alex").value).toBe("attended");
    expect(select(region, "Chris").value).toBe("not_recorded");
    expect(region.getByText("Saved counts: 4 registered · 1 attended · 2 absent · 1 not recorded")).toBeTruthy();
    expect(region.getByRole<HTMLButtonElement>("button", { name: "Save attendance" }).disabled).toBe(true);
  });

  it("offers exactly the three states, labelled Not recorded (not Absent)", async () => {
    renderApp();
    const options = within(select(await panel(), "Chris")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Attended", "Absent", "Not recorded"]);
  });

  it("F2-02: previews unsaved counts while keeping the saved baseline", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.selectOptions(select(region, "Chris"), "attended");
    expect(region.getByText("Unsaved counts: 4 registered · 2 attended · 2 absent · 0 not recorded")).toBeTruthy();
    expect(region.getByText("Saved counts: 4 registered · 1 attended · 2 absent · 1 not recorded")).toBeTruthy();
    expect(region.getByText(/unsaved attendance changes/i)).toBeTruthy();
    expect(useUiStore.getState().attendanceDirty).toBe(true);
  });

  it("F2-03: saves all members in one request with the draft's base revision", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.selectOptions(select(region, "Chris"), "attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await screen.findByText("Attendance saved")).toBeTruthy();
    expect(api.attendanceRequests).toEqual([
      {
        baseAttendanceRevision: 0,
        members: [
          { id: "M01", attendance: "attended" },
          { id: "M02", attendance: "absent" },
          { id: "M03", attendance: "attended" },
          { id: "M04", attendance: "absent" },
        ],
      },
    ]);
    await waitFor(() => {
      expect(region.getByText("Saved counts: 4 registered · 2 attended · 2 absent · 0 not recorded")).toBeTruthy();
    });
    expect(region.queryByText(/unsaved attendance changes/i)).toBeNull();
    expect(useUiStore.getState().attendanceDirty).toBe(false);
  });

  it("discards back to the saved values without asking (explicit action)", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.selectOptions(select(region, "Chris"), "attended");
    await user.click(region.getByRole("button", { name: "Discard attendance changes" }));
    expect(select(region, "Chris").value).toBe("not_recorded");
    expect(region.queryByText(/unsaved counts/i)).toBeNull();
  });

  it("F2-08: keeps the selections and explains a failed save", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/attendance", () =>
        apiErrorResponse(503, "STORE_UNAVAILABLE", "The event store is unavailable. Try again shortly."),
      ),
    );
    const { user } = renderApp();
    const region = await panel();
    await user.selectOptions(select(region, "Chris"), "attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await region.findByText("The event store is unavailable. Try again shortly.")).toBeTruthy();
    expect(select(region, "Chris").value).toBe("attended");
    expect(await screen.findByText(/^Attendance was not saved:/)).toBeTruthy();
  });

  it("explains a conflict, keeps the draft, and reloads only after confirmation", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.selectOptions(select(region, "Chris"), "attended");
    api.saveElsewhere(M04, "attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await region.findByText(/saved elsewhere/i)).toBeTruthy();
    expect(select(region, "Chris").value).toBe("attended");
    await user.click(region.getByRole("button", { name: "Reload saved attendance" }));
    await user.click(await screen.findByRole("button", { name: "Discard and reload" }));
    await waitFor(() => {
      expect(select(region, "Drew").value).toBe("attended");
    });
    expect(select(region, "Chris").value).toBe("not_recorded");
  });

  it("a refetch never overwrites a dirty draft, and its save still conflicts", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.selectOptions(select(region, "Chris"), "attended");
    api.saveElsewhere(M04, "attended");
    refocus();
    await waitFor(() => {
      expect(region.getByText(/Saved counts: 4 registered · 2 attended/)).toBeTruthy();
    });
    expect(select(region, "Chris").value).toBe("attended");
    expect(select(region, "Drew").value).toBe("absent");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await region.findByText(/saved elsewhere/i)).toBeTruthy();
    expect(api.view.members.find((m) => m.id === M03)?.attendance).toBe("not_recorded");
  });

  it("a clean form follows newer saved records", async () => {
    renderApp();
    const region = await panel();
    api.saveElsewhere(M04, "attended");
    refocus();
    await waitFor(() => {
      expect(select(region, "Drew").value).toBe("attended");
    });
  });

  it("reconciles a lost response that was in fact saved", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/attendance", () => {
        api.saveElsewhere(M03, "attended");
        return HttpResponse.error();
      }),
    );
    const { user } = renderApp();
    const region = await panel();
    await user.selectOptions(select(region, "Chris"), "attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await region.findByText("Your attendance changes were saved.")).toBeTruthy();
    expect(region.queryByText(/unsaved attendance changes/i)).toBeNull();
  });

  it("keeps the draft when a lost response was not saved", async () => {
    mswServer.use(http.put("/api/events/:eventId/attendance", () => HttpResponse.error()));
    const { user } = renderApp();
    const region = await panel();
    await user.selectOptions(select(region, "Chris"), "attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await region.findByText(/could not confirm the save/i)).toBeTruthy();
    expect(select(region, "Chris").value).toBe("attended");
  });

  it("locks inputs while saving and sends one request for a double-clicked Save", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/attendance", async ({ request }) => {
        await delay(150);
        api.attendanceRequests.push(await request.json());
        return apiErrorResponse(503, "STORE_UNAVAILABLE", "Busy.");
      }),
    );
    const { user } = renderApp();
    const region = await panel();
    await user.selectOptions(select(region, "Chris"), "attended");
    const save = region.getByRole("button", { name: "Save attendance" });
    await user.dblClick(save);
    expect(select(region, "Alex").disabled).toBe(true);
    await region.findByText("Busy.");
    expect(api.attendanceRequests).toHaveLength(1);
  });

  it("F2-10: every control is reachable and operable by keyboard", async () => {
    const { user } = renderApp();
    const region = await panel();
    act(() => {
      select(region, "Alex").focus();
    });
    for (const name of ["Bea", "Chris", "Drew"]) {
      await user.tab();
      expect(document.activeElement).toBe(select(region, name));
    }
    // jsdom has no native select popup; selectOptions on the focused select stands in for the arrow keys.
    await user.selectOptions(select(region, "Drew"), "attended");
    await user.tab();
    expect(document.activeElement).toBe(region.getByRole("button", { name: "Save attendance" }));
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Attendance saved")).toBeTruthy();
  });

  it("warns before leaving while attendance is unsaved", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.selectOptions(select(region, "Chris"), "attended");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
```

In `event-page.test.tsx`, change the expected level-2 headings to `["Attendance", "Feedback", "Briefing"]`.

Run: `pnpm test`
Expected: FAIL. The region "Attendance" is not found.

- [ ] **Step 4: Implement the form hook, counts and panel**

`apps/web/src/features/attendance/use-attendance-form.ts`:

```ts
import { zodResolver } from "@hookform/resolvers/zod";
import type { EventId, EventView, Member } from "@event-desk/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ApiError, describeApiError } from "../../data/http/api-error";
import { useSaveAttendance } from "../../data/mutations/use-save-attendance";
import { useBeforeUnloadWarning } from "../../shared/hooks/use-before-unload-warning";
import { useUiStore } from "../../state/ui-store";
import {
  AttendanceFormSchema,
  type AttendanceFormOutput,
  type AttendanceFormValues,
  draftMatchesSaved,
  toFormValues,
  toSaveRequest,
} from "./attendance-form-model";

export type AttendanceNotice =
  | { kind: "conflict"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "unconfirmed" }
  | { kind: "confirmed" };

export type RefetchEvent = () => Promise<{ data?: EventView | undefined }>;

/**
 * The attendance draft (React Hook Form) and its save flow (F2). The draft remembers the revision it
 * was based on, so a save after someone else's change conflicts instead of overwriting it.
 */
export function useAttendanceForm(eventId: EventId, view: EventView, refetch: RefetchEvent) {
  const form = useForm<AttendanceFormValues, unknown, AttendanceFormOutput>({
    resolver: zodResolver(AttendanceFormSchema),
    defaultValues: toFormValues(view.members),
  });
  // The roster is fixed (F2: no add/remove), so the draft is watched directly; no useFieldArray.
  const draft = useWatch({ control: form.control, name: "members" });
  const { isDirty } = form.formState;
  const baseRevision = useRef(view.attendanceRevision);
  // Synchronous double-submit guard: React state (isPending) lags a fast second click.
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<AttendanceNotice | null>(null);
  const save = useSaveAttendance(eventId);
  const setAttendanceDirty = useUiStore((state) => state.setAttendanceDirty);

  const resetTo = useCallback(
    (members: readonly Pick<Member, "id" | "attendance">[], revision: number) => {
      form.reset(toFormValues(members));
      baseRevision.current = revision;
    },
    [form],
  );

  // Newer saved data replaces a CLEAN form only; a dirty draft is never overwritten by a refetch.
  useEffect(() => {
    if (!form.formState.isDirty) resetTo(view.members, view.attendanceRevision);
  }, [form, resetTo, view.members, view.attendanceRevision]);

  useEffect(() => {
    setAttendanceDirty(isDirty);
  }, [isDirty, setAttendanceDirty]);
  useEffect(
    () => () => {
      setAttendanceDirty(false);
    },
    [setAttendanceDirty],
  );
  useBeforeUnloadWarning(isDirty);

  const submit = form.handleSubmit(async (values) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setNotice(null);
    try {
      const saved = await save.mutateAsync(toSaveRequest(values, baseRevision.current));
      resetTo(saved.members, saved.attendanceRevision);
    } catch (error) {
      if (error instanceof ApiError && error.outcomeUnknown) {
        const latest = (await refetch()).data;
        if (latest !== undefined && draftMatchesSaved(form.getValues(), latest.members)) {
          resetTo(latest.members, latest.attendanceRevision);
          setNotice({ kind: "confirmed" });
        } else {
          setNotice({ kind: "unconfirmed" });
        }
        return;
      }
      const message = describeApiError(error);
      setNotice(
        error instanceof ApiError && error.code === "ATTENDANCE_CONFLICT"
          ? { kind: "conflict", message }
          : { kind: "failed", message },
      );
    } finally {
      inFlight.current = false;
    }
  });

  const discard = () => {
    resetTo(view.members, view.attendanceRevision);
    setNotice(null);
  };

  const reloadSaved = async () => {
    const latest = (await refetch()).data;
    if (latest !== undefined) resetTo(latest.members, latest.attendanceRevision);
    setNotice(null);
  };

  return { form, draft, isDirty, isSaving: save.isPending, notice, submit, discard, reloadSaved };
}
```

`apps/web/src/features/attendance/attendance-counts.tsx`:

```tsx
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { AttendanceCounts as Counts } from "@event-desk/contracts";

const describe = (c: Counts) =>
  `${c.registered} registered · ${c.attended} attended · ${c.absent} absent · ${c.notRecorded} not recorded`;

/** Saved counts are the factual baseline; unsaved counts preview the draft and are labelled as such (F2). */
export function AttendanceCounts({ saved, draft, isDirty }: { saved: Counts; draft: Counts; isDirty: boolean }) {
  return (
    <div aria-live="polite">
      <VStack gap={1}>
        {isDirty ? <Text weight="bold">Unsaved counts: {describe(draft)}</Text> : null}
        <Text type={isDirty ? "supporting" : "body"}>Saved counts: {describe(saved)}</Text>
      </VStack>
    </div>
  );
}
```

`apps/web/src/features/attendance/attendance-panel.tsx`:

```tsx
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Field } from "@astryxdesign/core/Field";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_STATUSES,
  deriveAttendanceCounts,
  type EventId,
  type EventView,
} from "@event-desk/contracts";
import { useState } from "react";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { AttendanceCounts } from "./attendance-counts";
import { type AttendanceNotice, type RefetchEvent, useAttendanceForm } from "./use-attendance-form";

function NoticeBanner({ notice, onReload }: { notice: AttendanceNotice; onReload: () => void }) {
  switch (notice.kind) {
    case "conflict":
      return (
        <Banner
          status="warning"
          title="Attendance changed elsewhere"
          description={`${notice.message} Your selections are kept until you choose to reload.`}
          endContent={<Button label="Reload saved attendance" variant="secondary" onClick={onReload} />}
        />
      );
    case "failed":
      return <Banner status="error" title="Attendance was not saved" description={notice.message} />;
    case "unconfirmed":
      return (
        <Banner
          status="warning"
          title="Could not confirm the save"
          description="The saved records do not match your selections. They are kept; check them and save again."
        />
      );
    case "confirmed":
      return <Banner status="success" title="Your attendance changes were saved." />;
  }
}

export function AttendancePanel({ eventId, view, refetch }: { eventId: EventId; view: EventView; refetch: RefetchEvent }) {
  const attendance = useAttendanceForm(eventId, view, refetch);
  const [confirmingReload, setConfirmingReload] = useState(false);
  const names = new Map(view.members.map((m) => [m.id as string, m.name]));

  return (
    <section aria-label="Attendance">
      <VStack gap={3}>
        <Heading level={2}>Attendance</Heading>
        <form
          noValidate
          onSubmit={(event) => {
            void attendance.submit(event);
          }}
        >
          <VStack gap={3}>
            {attendance.draft.map((member, index) => {
              const inputId = `attendance-${member.id}`;
              return (
                <Field key={member.id} label={names.get(member.id) ?? member.id} inputID={inputId}>
                  <select id={inputId} disabled={attendance.isSaving} {...attendance.form.register(`members.${index}.attendance`)}>
                    {ATTENDANCE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {ATTENDANCE_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            })}
            <AttendanceCounts saved={view.counts} draft={deriveAttendanceCounts(attendance.draft)} isDirty={attendance.isDirty} />
            {attendance.isDirty ? (
              <Text>Unsaved attendance changes. Save or discard them before generating a briefing.</Text>
            ) : null}
            {attendance.notice ? (
              <NoticeBanner
                notice={attendance.notice}
                onReload={() => {
                  setConfirmingReload(true);
                }}
              />
            ) : null}
            <HStack gap={2}>
              <Button
                type="submit"
                variant="primary"
                label="Save attendance"
                isDisabled={!attendance.isDirty || attendance.isSaving}
                isLoading={attendance.isSaving}
              />
              {attendance.isDirty ? (
                <Button
                  variant="secondary"
                  label="Discard attendance changes"
                  isDisabled={attendance.isSaving}
                  onClick={attendance.discard}
                />
              ) : null}
            </HStack>
          </VStack>
        </form>
      </VStack>
      <ConfirmDialog
        isOpen={confirmingReload}
        title="Reload saved attendance?"
        description="Your unsaved selections will be discarded and replaced by the latest saved attendance."
        actionLabel="Discard and reload"
        onCancel={() => {
          setConfirmingReload(false);
        }}
        onConfirm={() => {
          setConfirmingReload(false);
          void attendance.reloadSaved();
        }}
      />
    </section>
  );
}
```

Astryx `Button` defaults to `type="button"`, so only Save sets `type="submit"`; Discard and Reload never submit the form.

In `event-page.tsx`:
- Import `AttendancePanel`.
- Replace `{/* attendance: Task 7 */}` with:

```tsx
        <PanelErrorBoundary name="Attendance">
          <AttendancePanel eventId={eventId} view={view} refetch={query.refetch} />
        </PanelErrorBoundary>
```

- [ ] **Step 5: Run the tests until they pass**

Run: `pnpm test`
Expected: PASS. Fix the implementation, not the tests. The only acceptable test edits are the three listed under Step 3 and fallbacks the brief allows explicitly.

- [ ] **Step 6: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0, with `pnpm arch` clean. `state/` imports nothing from `data/`, and `features/` imports no Axios or endpoint modules.

```bash
git add apps/web/src
git commit -m "feat(web): attendance panel with unsaved counts, save, discard, conflicts and lost-response reconciliation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Run the stack end to end and document it

**Files:**
- Modify: `AGENTS.md` (Commands table)

**Interfaces:**
- Consumes: everything above, plus the Plan 2 API.
- Produces: verified `pnpm dev` (API on :4000, web on :5173 with the `/api` proxy) and updated working agreements.

- [ ] **Step 1: Start the stack**

With MySQL and Redis up and `.env` present:

```bash
pnpm dev > /tmp/event-desk-dev.log 2>&1 &
sleep 8
```

- [ ] **Step 2: Check the same-origin proxy and the API guards**

```bash
curl -s http://localhost:5173/api/health
curl -s http://localhost:5173/api/events/E101 | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:5173/api/events/E101/attendance \
  -H "Content-Type: application/json" -H "Origin: http://localhost:5173" \
  -d '{"baseAttendanceRevision":0,"members":[{"id":"M01","attendance":"attended"},{"id":"M02","attendance":"absent"},{"id":"M03","attendance":"not_recorded"},{"id":"M04","attendance":"absent"}]}'
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:5173/api/events/E101/attendance \
  -H "Content-Type: application/json" -H "Origin: http://evil.example" -d '{}'
curl -s http://localhost:5173/ | grep -c 'id="root"'
```

Expected:
- `{"mysql":"up","redis":"up"}`;
- event JSON starting `{"event":{"id":"E101"`;
- `200` for the unchanged same-origin save. If a previous run left attendance changed, use the current `attendanceRevision` from the GET; a 409 also proves the proxy reached the API;
- `403` for the foreign origin;
- `1` for the HTML shell.

If the proxy forwards `Host: 127.0.0.1:4000` instead of `localhost:5173`, the API's host guard still passes, because `127.0.0.1` is allowed. Record what you saw.

- [ ] **Step 3: Stop the stack**

```bash
kill %1; sleep 2
lsof -iTCP:4000 -sTCP:LISTEN -n -P; lsof -iTCP:5173 -sTCP:LISTEN -n -P
```

Expected: nothing is listening. Kill any remaining child process by its PID. The controller does the in-browser check (rendering, editing, saving, refreshing, keyboard use and narrow width) after this task.

- [ ] **Step 4: Update the working agreements**

In `AGENTS.md`, replace the `pnpm dev` row of the Commands table with:

```markdown
| `pnpm dev` | Event API on http://127.0.0.1:4000 and the coordinator web app on http://localhost:5173 (Vite proxies `/api` to the API — same origin, no CORS) |
```

Add this row after `pnpm test`:

```markdown
| `pnpm build` | `tsc -b` for the Node packages, then the production web bundle (`apps/web/dist`) |
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm format && pnpm verify && pnpm build`
Expected: exit 0.

```bash
git add AGENTS.md
git commit -m "docs: document running the API and the coordinator web app together" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Done when

- `pnpm verify`, `pnpm test:integration` and `pnpm build` pass on a clean checkout after `pnpm install`.
- `pnpm dev` serves the coordinator page at http://localhost:5173/events/E101 against the real API.
  - It shows the ended Saturday Walk, the four members with editable statuses, saved and unsaved counts, Save and Discard, and the eight read-only notes.
  - Saved changes survive a refresh.
- The F2 flows are covered by component tests against an MSW fake that follows the real contract: conflict, failure, lost response, double submit, keyboard use and the unload warning. So are the F1 loading, error and not-found states, and F3's inert note text.
- Every mutation produces exactly one toast through the shared policy.
- `pnpm arch` enforces the web data and UI layering, and every web rule has been shown to fire.
