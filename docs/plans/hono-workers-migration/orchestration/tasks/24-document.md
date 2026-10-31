# 24 Interview document commands

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [23](./23-interview-question.md), [03](./03-vectors.md).

Read: [codecs](../../codecs.md); [primitives](../../primitives.md); [realtime](../../realtime.md).

## Assignment

Implement ordered UTF-16 document update/pull/replay, epoch/version fences, idempotent keys and language drafts using official ChangeSet format where compatible.

Proposed write scope: `modules/interviews/document/; postgres/interviews/document/`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `interviews/changes.go; interviews_document; active drafts; client collaboration controllers`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Concurrent/replayed/offline batches, surrogate split/byte cap, lost ACK and language-switch recovery; no duplicate document authority.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
