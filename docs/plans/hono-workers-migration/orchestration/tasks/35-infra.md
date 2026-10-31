# 35 Terraform native backend resources

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [16](./16-scheduler.md), [29](./29-runner-resume.md), [32](./32-do-sockets.md), [12](./12-auth-capabilities.md).

Read: [architecture](../../architecture.md); [rollout](../../rollout.md); [database](../../database.md).

## Assignment

Prepare native Worker/auth/DO/queue/Hyperdrive bindings, private judge reachability, scheduled recovery and role revision fencing. Preserve live class migration history.

Proposed write scope: `infra/terraform additions and local fixtures; no apply`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `infra/terraform/app; case-validation; deploy container/worker bindings`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Terraform fmt/validate/test and reviewed plan-shaped fixtures; no provisioning; no KV/vector resources; DB and runtime budgets explicit.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
