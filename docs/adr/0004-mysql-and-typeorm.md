# 0004. MySQL 8.4 through TypeORM

Status: Accepted (2026-10-03) · Spec: [D3](../specs/README.md#decisions), [T4](../specs/13-data-model-and-transactions.md)

## Context
The brief asks for a simple persistent store whose saves survive restart. The design needs atomic
multi-row writes and a single serialisation point per event.

## Options
JSON file; SQLite; MongoDB/Mongoose (earlier choice); MySQL with TypeORM.

## Decision
MySQL 8.4 (InnoDB) through TypeORM `EntitySchema` mappings behind a repository layer. Every write is
one transaction that first locks the event row. Migrations are hand-written SQL; `synchronize` is off.

## Consequences
Durable commits (`innodb_flush_log_at_trx_commit=1`) and DB-enforced integrity. Requires Docker for
local runs. `EntitySchema` avoids decorators, which esbuild-based tools (`tsx`, Vitest) cannot emit
metadata for.
