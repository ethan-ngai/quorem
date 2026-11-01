# 16 Deadline and maintenance processing

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [15](./15-dispatch.md).

Read: [scheduling](../../scheduling.md); [background](../../background.md).

## Assignment

Implement DB-clock deadline scheduling and bounded retention; sharded DO alarm coordination and Node scheduling share contracts. Add independent recovery sweep.

Proposed write scope: `modules/events/scheduling/; assigned alarm/scheduled adapters and deadline repositories`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `matches deadline scheduler; postgres match_deadlines; cleanup/outbox retention`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Stale/late/duplicate alarm and exhausted retry recovery; no second transition authority; measured fallback meets product gate.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
