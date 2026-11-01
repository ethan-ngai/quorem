# 18 Submission admission transaction

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [17](./17-workspace.md), [15](./15-dispatch.md), [09](./09-execution-contracts.md).

Read: [primitives](../../primitives.md); [background](../../background.md); [execution](../../execution.md).

## Assignment

Port run/submit/custom-case admission with prewake, canonical fingerprint, quotas, guest reservations and one nonterminal owner job. Derive all context server-side.

Proposed write scope: `modules/judging/admission/; postgres/judging/admission/`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `httpapi execution_wake/admit; postgres execution_admission, guest_budgets`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Contention, unknown commit, changed retry fingerprint, early wake, wake failure and private case tests; compatible Go judge executes admitted jobs.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
