# 25 Interview presence and monitoring

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [24](./24-document.md).

Read: [realtime](../../realtime.md); [primitives](../../primitives.md); [auth](../../auth.md).

## Assignment

Port expiring cross-instance window leases, advisory presence and bounded idempotent rule events; separate advisory and document lanes.

Proposed write scope: `modules/interviews/presence/ monitoring/; corresponding postgres dirs`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `interviews_presence; realtime_presence; monitoring; interview_hub tests`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Multi-instance quota, expiry/role removal, paste/focus privacy and slow-command heartbeat tests; no process-local authoritative quota.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
