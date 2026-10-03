# 0001. Record architecture decisions

Status: Accepted (2026-10-03) · Spec: [T3 §10](../specs/12-architecture-and-repository.md#10-engineering-principles-showcase-quality)

## Context
The assignment is judged on its decisions as much as its features. The specs hold the full design but
mix requirements with rationale.

## Options
Rationale only in specs; a single decisions log; one short record per decision.

## Decision
One ADR per confirmed decision in `docs/adr/`, each with context, options, decision and consequences,
linking to the spec that holds the details.

## Consequences
A reviewer can read why without reading every spec. A changed decision gets a new ADR that supersedes
the old one; ADRs are not edited to rewrite history.
