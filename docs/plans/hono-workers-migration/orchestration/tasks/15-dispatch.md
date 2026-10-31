# 15 Durable work claim and wake primitives

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [06](./06-db-primitives.md), [09](./09-execution-contracts.md).

Read: [background](../../background.md); [primitives](../../primitives.md).

## Assignment

Implement fenced bounded dispatch claims, publish-before-ack, required prewake/commit-race handling, durable continuation and retry/recovery contracts. Keep work types distinct.

Port supported AWS SQS and Cloudflare delivery adapters behind the same wake semantics; retain local PostgreSQL notification acceleration. Provider protocol fixtures prove parity without cloud credentials. Do not replace mixed-provider configuration with a global cloud switch.

Proposed write scope: `modules/events/dispatch/; postgres/events/; delivery adapters under assigned subdirs`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `httpapi outbox dispatch; postgres event outboxes; internal/delivery; deploy/worker.js wake`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Crash after commit, early wake, lost ACK, contention/final-drain arrival and exhausted retry tests; duplicate safe, no stranded intent.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
