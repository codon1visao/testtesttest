# 0017. The briefing answers the brief's four questions

Status: Accepted (2026-10-03) · Spec: [D16](../specs/README.md#decisions), [F4](../specs/04-ai-briefing-generation.md)

## Context
The brief wants to know what happened, which themes recur, where people disagree and what might be
worth following up. An attendance-only overview left the feedback side of "what happened" unanswered.

## Options
Attendance overview only; a model-written overview including counts; a code-built overview plus a cited
feedback summary.

## Decision
"What happened" is the code-built attendance overview (fact; says when attendance is incomplete) plus one
model-written feedback summary (reported opinion, at least one cited note, at most 600 characters, no
counts). UI headings follow the four questions.

## Consequences
The model can never change or restate counts; facts and reported opinion stay distinguishable.
