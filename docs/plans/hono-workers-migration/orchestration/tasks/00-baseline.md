# 00 Baseline and inventory

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: Implementation authorization.

Read: [scope](../../scope.md); [architecture](../../architecture.md).

## Assignment

Resolve integration baseline; inventory routes, WS commands, internal protocols, CLIs, schema objects, flags and all writers. Reconcile PR #322 before freezing leases.

Proposed write scope: `planning inventories and ledger only`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `apps/api/internal/httpapi; apps/api/worker; apps/runner; apps/language; workflows; migrations`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Every existing entrypoint has a packet owner; baseline/branch decision and unsupported behavior recorded. No branch rewrite or product code.

Use existing fixture/test tools or isolated spike commands; record exact commands and results. Do not depend on foundation packet 04, which consumes these reports. Add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
