# 20 Match lifecycle and reconciliation

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [18](./18-admission.md), [16](./16-scheduler.md), [13](./13-catalog.md).

Read: [primitives](../../primitives.md); [scheduling](../../scheduling.md); [canonical-owners](../../canonical-owners.md).

## Assignment

Implement create/settings/ready/start/leave/forfeit and pure outcome/deadline transitions with atomic reservations, DB clock and versioned notices.

Proposed write scope: `modules/matches/lifecycle/; postgres/matches/lifecycle/`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `matches/reconcile; postgres matches/match_rules/match_reconcile; mutate routes`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Concurrent join/start/outcome/deadline tests; late results and no-contest semantics preserved; no transition logic in alarm adapters.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
