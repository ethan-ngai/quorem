# 26 Interview execution admission and feedback

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [24](./24-document.md), [19](./19-results.md), [23](./23-interview-question.md).

Read: [execution](../../execution.md); [primitives](../../primitives.md); [codecs](../../codecs.md).

## Assignment

Port source hash/document/question epoch admission and shared result/step feedback with interviewer-private views. Reuse general admission primitives and canonical stage policy.

Proposed write scope: `modules/interviews/execution/; postgres/interviews/execution/`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `interviews_execution; execution integrity/fence tests; private result handlers`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Stale source/epoch rejected; original retry works after edit; public/private result matrix and step feedback/manual advance pass.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
