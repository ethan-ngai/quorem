# 01 Workerd Drizzle spike

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [00](./00-baseline.md).

Read: [database](../../database.md); [http-runtime](../../http-runtime.md); [validation](../../validation.md).

## Assignment

Execute Drizzle over pg/Hyperdrive-shaped local binding: transactions, rollback, lock deadlines, bigint, bytea, request lifetimes. Pin compatible Drizzle/Kit/pg/workerd test versions.

Proposed write scope: `isolated test/spike files; no product implementation`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `apps/auth/src/database.ts; postgres admission/queue tests`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Actual workerd + disposable PG report; no process-global connection reuse, lost precision or unsupported session assumptions.

Use existing fixture/test tools or isolated spike commands; record exact commands and results. Do not depend on foundation packet 04, which consumes these reports. Add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
