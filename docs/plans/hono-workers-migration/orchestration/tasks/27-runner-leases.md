# 27 Trusted runner claim and lease lifecycle

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [18](./18-admission.md), [19](./19-results.md), [09](./09-execution-contracts.md), [06](./06-db-primitives.md).

Read: [execution](../../execution.md); [database](../../database.md); [primitives](../../primitives.md).

## Assignment

Port claims, leases, heartbeats, cancellation, fenced completion and accounting. Preserve capability gates and exact teardown proof before expired reclaim.

Proposed write scope: `apps/runner/src/queue/; runner-owned postgres execution commands`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `apps/api/worker; postgres queue/checkpoints/cancellations; PR #322 result`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Stale attempt/proof/complete, concurrent claims, retry exhaustion and guest settlement tests; notification IDs never select authorized jobs.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
