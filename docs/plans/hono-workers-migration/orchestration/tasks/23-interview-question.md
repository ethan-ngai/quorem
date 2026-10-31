# 23 Interview question and stage controls

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [22](./22-interview-core.md), [08](./08-question-codecs.md).

Read: [canonical-owners](../../canonical-owners.md); [codecs](../../codecs.md); [primitives](../../primitives.md).

## Assignment

Port question selection/snapshots, hints, visibility/admission policy and host-driven stage controls. Reuse canonical validation and stage-policy owner.

Proposed write scope: `modules/interviews/question/; corresponding postgres dirs`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `interview_question_library; question snapshots/selection/custom stages; hints/visibility/admission controls`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Immutable snapshot, private library, epoch change and stage-control tests; hidden-test access and manual advance semantics preserved.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
