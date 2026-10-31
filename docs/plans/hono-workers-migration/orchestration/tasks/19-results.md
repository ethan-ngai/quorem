# 19 Submission results and cancellation

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [18](./18-admission.md).

Read: [codecs](../../codecs.md); [primitives](../../primitives.md); [execution](../../execution.md).

## Assignment

Implement owner-safe status/results, monotonic cancellation, public/private projection and lossless result persistence consumption. Define shared snapshot port.

Proposed write scope: `modules/judging/results/ cancellation/; postgres/judging/results/`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `httpapi submission/cancel; postgres submissions/result_storage/cancellations`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Lost/repeated cancel, stale completion and NUL payload reads; internal job/attempt IDs remain private; terminal result behavior preserved.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
