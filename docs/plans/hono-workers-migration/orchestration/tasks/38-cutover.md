# 38 Authorized staging and production cutover

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [37](./37-audit.md).

Read: [rollout](../../rollout.md); [validation](../../validation.md).

## Assignment

After explicit release authorization, validate hosted isolation/workload and staged route cutover/drain/rollback gates. Preserve sessions, lossless readers and checkpoint capabilities.

Proposed write scope: `orchestrator release operations and evidence only`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `GitHub Actions/Terraform plans; retained old runtime; live role revision evidence`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Actual role versions and authenticated full flows; no old active authority; measured capacity/recovery/cost; exercised compatible rollback.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
