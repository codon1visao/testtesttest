# 0005. OpenAI Agents SDK, inside the Gateway only

Status: Accepted (2026-10-02) · Spec: [D4](../specs/README.md#decisions), [S1](../specs/08-openai-security.md)

## Context
The brief requires a real model call from the backend; feedback is untrusted input.

## Options
Raw Responses API calls; the OpenAI Agents SDK; another provider.

## Decision
One briefing agent built with the OpenAI Agents SDK, running only in `apps/ai-gateway`: Responses API,
strict Structured Outputs from the shared Zod schema, no tools or handoffs, `store: false`, tracing
disabled, SDK retries off. Model and versions are pinned during implementation.

## Consequences
Structured output constrains shape, not truth: the event backend still validates evidence and a human
reviews. The SDK's schema mapping must be verified against the installed version.
