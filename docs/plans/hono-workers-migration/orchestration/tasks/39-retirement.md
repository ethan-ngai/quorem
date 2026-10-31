# 39 Go and obsolete path removal

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [38](./38-cutover.md).

Read: [completion](../../completion.md); [rollout](../../rollout.md).

## Assignment

After observation/drain gate, remove superseded Go and obsolete API container/relay paths; preserve needed judge/case hosts and DO migrations. Update final architecture/runbooks.

Proposed write scope: `orchestrator coordinated Go/build/CI/docs removals`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `entrypoint matrix; Go references across scripts/images/workflows/docs`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

No Go source/tool/runtime dependency left; all consumers active; native Worker + Node portability suites pass; zero unused adapters/defaults.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
