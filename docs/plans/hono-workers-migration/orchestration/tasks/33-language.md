# 33 TypeScript language gateway consolidation

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [10](./10-identity-access.md), [04](./04-foundation.md).

Read: [execution](../../execution.md); [auth](../../auth.md).

## Assignment

Consolidate Go gateway semantics into existing TS owner; retain opt-in identity/entitlement, isolated subprocess host, framing and resource limits.

Proposed write scope: `apps/language/src/ and its tests`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `apps/language/internal/gateway; existing src runtime/framing/policy/cleanup`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Existing policy/framing/cleanup and shutdown/idle/session limits pass; browser-first default unchanged; no language engines spawned in Workers.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
