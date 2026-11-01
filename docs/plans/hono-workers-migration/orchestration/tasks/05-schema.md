# 05 Drizzle schema and migration mapping

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [04](./04-foundation.md).

Read: [database](../../database.md); [codecs](../../codecs.md).

## Assignment

Map product/auth tables, qualified namespaces, indexes/checks, lossless types and trigger inventory. Preserve SQL migration runner history; set reviewed Kit authoring workflow.

Proposed write scope: `packages/database/src/schema/; migration CLI mapping tests; orchestrator-controlled exports`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `apps/api/migrations; apps/auth/migrations; postgres/store.go; auth migrations`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Fresh and restored schema parity, no destructive adoption SQL, no second journal, repeated migration safe; auth/product ledgers unchanged.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
