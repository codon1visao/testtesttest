# T1 — Frontend technologies and conventions

[All specifications](README.md)

Status: **Confirmed by the user on 2026-10-02; React Router and Server-Sent Events added 2026-10-03.** This records the selected stack and conventions; application implementation has not started.

## Selected stack

| Area | Choice |
| --- | --- |
| Foundation | React, TypeScript and Vite; prefer the latest stable, compatible React release |
| Package management | pnpm |
| Routing | React Router v7 in declarative mode (confirmed 2026-10-03): `/` → `/events/E101`, coordinator page `/events/:eventId`, test feedback form `/events/:eventId/feedback`, not-found route. Data loading stays in React Query. |
| Live updates | Server-Sent Events via the browser's `EventSource` (confirmed 2026-10-03): `changed` messages invalidate the event query; polling fallback |
| Location | `apps/web` in the root pnpm workspace; shared contracts from `packages/contracts` ([T3](12-architecture-and-repository.md)) |
| HTTP requests | Axios |
| Server data and mutations | TanStack Query (React Query) |
| UI and styling | [Astryx](https://astryx.atmeta.com/) |
| Forms and validation | React Hook Form and Zod |
| Global client state | Zustand |
| Mutation feedback | Success and error toasts for every mutation action, using Astryx's toast facilities |
| Architecture | Layered, with data access separated from UI |
| File organisation | Multiple related React components may share a file |
| Naming | Kebab-case for folders and filenames, such as `briefing-editor.tsx` |

Follow the [shared clean-code conventions](11-backend-technologies.md#shared-clean-code-conventions): clear names, focused responsibilities, reusable contracts/logic and explicit error handling.

The official [React versions page](https://react.dev/versions) lists 19.3 as the latest version on 2026-10-02. Check the latest stable patch and selected-library compatibility when implementing, then lock the resolved versions. Astryx documents React 19+ and StyleX; follow its [official setup](https://astryx.atmeta.com/docs/getting-started). Version compatibility has not yet been tested in this repository.

## Layer and state ownership

- **Data layer:** shared Axios client, endpoint functions, React Query queries/mutations and reusable contracts/validation. UI components consume this layer rather than issuing Axios requests directly. Reuse functions, APIs, schemas and hooks instead of duplicating them.
- **UI layer:** React components, Astryx controls, form bindings and presentation. Multiple related components in one file are allowed; kebab-case applies to file/folder names, while React component identifiers retain PascalCase.
- **React Query:** owns fetched server state and request status. **React Hook Form + Zod:** own editable form drafts and their validation. **Zustand:** owns shared client/UI state; do not duplicate server caches or form drafts in it.
- Background refreshes and incoming generated previews must preserve a dirty briefing form, the selected generation and its fixed source references. Reset form baselines only through the explicit save, discard or selection flows in [F5](05-briefing-editor.md) and [F7](07-generation-queue.md). Attendance has no draft (it saves on each change, [F2](02-attendance.md)); a refresh never replaces a change while its save is in flight.

## Mutation feedback

Every mutation action shows one success or error toast, including attendance saves, generation requests/retries, preview selection and briefing saves/replacement. Use a shared policy and [Astryx toast facilities](https://astryx.atmeta.com/components/LayerProvider); avoid duplicate notifications from both the HTTP client and mutation handlers. Keep actionable validation/conflict errors visible beside the relevant form as well.

Generate is synchronous: its success toast says **Briefing generated** (a preview, not a saved briefing). Automatic batch results from new feedback are announced separately, once per outcome. The feedback form's submit shows **Feedback submitted**. Live changes arrive through the SSE change stream, which invalidates the event query; it never resets dirty forms. Repeated polling responses must not repeat toasts or overwrite drafts. Generation retries remain owned by the backend queue; do not automatically replay mutation requests from the frontend.

Backend choices and shared conventions are recorded in [T2](11-backend-technologies.md). No dependencies have been installed; additional production dependencies require confirmation under the repository working agreements.
