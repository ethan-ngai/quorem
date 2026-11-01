# 30 Shared browser socket protocol

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [21](./21-match-invites.md), [25](./25-presence.md), [26](./26-interview-exec.md), [19](./19-results.md).

Read: [realtime](../../realtime.md); [primitives](../../primitives.md).

## Assignment

Implement neutral command correlation, authorization hooks, bounded lanes, subscribe-before-snapshot, coalescing/version recovery and token lifecycle contracts.

Proposed write scope: `modules/events/socket/ and protocol tests`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `interview_realtime; submission/match/invite/membership streams; browser RPC/reconnect consumers`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

All RPC/stream conformance cases including role changes, missed notices, terminal close and slow clients; no transport-specific domain policy.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
