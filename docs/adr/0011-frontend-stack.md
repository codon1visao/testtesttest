# 0011. Frontend stack and conventions

Status: Accepted (2026-10-02; React Router 2026-10-03) · Spec: [D10](../specs/README.md#decisions), [T1](../specs/10-frontend-technologies.md)

## Context
The brief requires React/TypeScript and familiar libraries; the UI must preserve drafts while server
data refreshes.

## Options
Hand-rolled fetch and state; a full framework (Next.js/Remix); a Vite SPA with focused libraries.

## Decision
React + TypeScript + Vite, React Router v7 (declarative), Axios + TanStack Query (server state), React
Hook Form + Zod (drafts), Zustand (cross-panel UI state only), Astryx for components, success/error toast
per mutation.

## Consequences
Clear state ownership: server data never copied into Zustand, drafts reset only on explicit actions.
Astryx with StyleX on Vite is new; a spike verifies it (`docs/spikes/astryx-vite.md`).
