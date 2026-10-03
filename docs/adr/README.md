# Architecture decision records

One short record per confirmed decision: context, options, decision, consequences. The specs in
`docs/specs/` hold the full design; these records explain why. Status values: Accepted, Superseded.

| ADR | Decision | Spec |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record decisions as ADRs | T3 §10 |
| [0002](0002-separate-preview-for-regeneration.md) | Regeneration writes a separate preview | D1 |
| [0003](0003-text-only-briefing-edits.md) | Briefing edits change text only | D2 |
| [0004](0004-mysql-and-typeorm.md) | MySQL 8.4 through TypeORM | D3 |
| [0005](0005-openai-agents-sdk-in-gateway.md) | OpenAI Agents SDK, inside the Gateway only | D4 |
| [0006](0006-freshness-by-snapshot-comparison.md) | Freshness by snapshot comparison | D5 |
| [0007](0007-generation-triggers.md) | Two generation triggers | D6 |
| [0008](0008-bullmq-batch-queue.md) | BullMQ for feedback batches | D7 |
| [0009](0009-internal-ai-gateway-over-tcp.md) | Internal AI Gateway over TCP | D8 |
| [0010](0010-manual-priority-and-fixed-windows.md) | Manual priority, fixed batch windows | D9 |
| [0011](0011-frontend-stack.md) | Frontend stack and conventions | D10 |
| [0012](0012-backend-stack-and-workspace.md) | Backend stack and one pnpm workspace | D11 |
| [0013](0013-conflicts-cite-two-notes.md) | A conflict cites at least two notes | D12 |
| [0014](0014-retry-is-generate-again.md) | Retry is Generate again | D13 |
| [0015](0015-server-sent-events.md) | Server-Sent Events for live updates | D14 |
| [0016](0016-normalised-schema-with-composite-keys.md) | Normalised schema with composite FKs | D15 |
| [0017](0017-briefing-answers-four-questions.md) | The briefing answers the brief's four questions | D16 |
| [0018](0018-versioned-event-view-cache.md) | Versioned Redis cache for the event read | T3 A4 |
