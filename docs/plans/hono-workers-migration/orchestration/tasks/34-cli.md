# 34 Go-backed CLI and seed replacements

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [14](./14-authoring.md), [09](./09-execution-contracts.md), [06](./06-db-primitives.md).

Read: [execution](../../execution.md); [codecs](../../codecs.md); [database](../../database.md).

## Assignment

Port seeding/import/validation/profiling consumers to canonical packages and Drizzle CLI without changing data authorization or publishing semantics.

Proposed write scope: `explicitly assigned CLI replacements and fixture tooling; root scripts coordinated`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `Makefile seed; validate-leetcode-structure.py; profiler/import scripts; Go command inventory`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Inventory shows replacement for every embedded go/run command; fresh fixtures/repeated seed tests; migration history and production seed gates preserved.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
