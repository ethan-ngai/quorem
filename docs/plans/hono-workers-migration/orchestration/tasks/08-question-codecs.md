# 08 Exact case codecs and comparisons

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [07](./07-question-model.md), [03](./03-vectors.md).

Read: [codecs](../../codecs.md); [database](../../database.md).

## Assignment

Implement lossless numeric/case/SQL codecs and comparators; preserve ordered/unordered results, void calls, NUL sidecars and hashes.

Proposed write scope: `packages/questions/src/codecs/ and comparison tests`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `problems/{codec,input,case_codec,sql}.go; runner comparison tests`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Numeric/timestamp/byte vectors pass; bounded large inputs; public/private codec consumers share the implementation.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
