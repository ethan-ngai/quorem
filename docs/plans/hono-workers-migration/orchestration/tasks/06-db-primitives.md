# 06 Transaction and persistence primitives

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [05](./05-schema.md).

Read: [database](../../database.md); [primitives](../../primitives.md).

## Assignment

Implement invocation-scoped Drizzle factory, transaction-bound types, error classification, exact DB codecs and shared lock/deadline conventions. Keep domain operations out.

Proposed write scope: `packages/database/src/core/ and focused tests`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `postgres admission/queue/result_storage; pg connection code`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Rollback/constraint/lock/unknown-commit tests; pg and Drizzle use one client per transaction; bounds and connection release verified.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
