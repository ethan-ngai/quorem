# 28 Sandbox adapters and framed execution

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [27](./27-runner-leases.md).

Read: [execution](../../execution.md); [codecs](../../codecs.md).

## Assignment

Implement HTTP-remote and local Docker adapters, framed streaming, compile reuse, per-case bounds and confirmed teardown. Preserve existing isolated harnesses.

Proposed write scope: `apps/runner/src/engine/ sandbox/ plus focused tests`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `apps/runner/internal/engine; Python/polyglot/Postgres harnesses; deploy/case-sandbox`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

All five language modes, truncated streams, aborts, output caps and isolation fixtures; no untrusted execution in Worker isolate.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
