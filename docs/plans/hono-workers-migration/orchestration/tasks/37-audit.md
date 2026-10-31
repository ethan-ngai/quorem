# 37 Independent security and parity audit

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [36](./36-deploy.md).

Read: [validation](../../validation.md); [completion](../../completion.md); [canonical-owners](../../canonical-owners.md); [extensions](../../extensions.md).

## Assignment

Audit every inventory entry, canonical reuse, Drizzle projections/transactions/schema, distributed authority, failure recovery and Node portability. Confirm zero cache/search implementation.

Proposed write scope: `read-only audit first; fixes assigned separately`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `complete entrypoint matrix; integrated diff; privacy/lease tests`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Recorded actionable findings resolved by scoped packets; complete coverage and meaningful runtime/DB/browser evidence; hosted gates explicit.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
