# 03 Cross-runtime behavior vectors

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [00](./00-baseline.md).

Read: [codecs](../../codecs.md); [validation](../../validation.md).

## Assignment

Capture exact question/hash/idempotency/numeric/UTF-16/frame behavior, with public and judge-private fixture locations separated.

Proposed write scope: `contract fixtures and temporary oracle tooling only`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `problems codecs/starter/SQL; interviews/changes.go; execution frame/checkpoint tests`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Reproducible vectors and explicit decisions for inconsistent behavior; no hidden fixture export through browser package.

Use existing fixture/test tools or isolated spike commands; record exact commands and results. Do not depend on foundation packet 04, which consumes these reports. Add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
