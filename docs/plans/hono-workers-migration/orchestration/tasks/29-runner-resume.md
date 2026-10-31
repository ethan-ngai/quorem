# 29 Checkpoint replay and bounded drains

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [28](./28-runner-engine.md).

Read: [execution](../../execution.md); [background](../../background.md).

## Assignment

Port streamed paginated checkpoint restore/save/yield and bounded authenticated HTTP drains; preserve timings, accounting and continuation semantics.

Proposed write scope: `apps/runner/src/checkpoints/ drains/; assigned checkpoint persistence`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `worker drain/checkpoint tests; engine accumulator/compiled; compressed checkpoint SQL`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Large suite memory/backpressure, stale checkpoint, lease loss, incomplete-drain continuation and restart recovery; Go API can use TS judge.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
