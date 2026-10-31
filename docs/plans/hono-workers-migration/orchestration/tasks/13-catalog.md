# 13 Authorized catalog and content queries

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [08](./08-question-codecs.md), [10](./10-identity-access.md).

Read: [canonical-owners](../../canonical-owners.md); [extensions](../../extensions.md); [database](../../database.md).

## Assignment

Implement current catalog, version-addressed published content, editorial/complexity and focused candidate queries. Use explicit projections, authoritative visibility and stable keyset cursors.

Proposed write scope: `modules/problems/queries/; postgres/problems/queries/`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `problem catalog/content/sealing; editorials/complexity routes; current selector consumers`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Public/private/deleted/revoked projection tests; no N+1 hot read; current SQL candidate behavior behind narrow contract; no cache/vector adapter.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
