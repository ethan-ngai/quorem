# 36 Deployment and local integration

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [35](./35-infra.md), [31](./31-node-sockets.md), [33](./33-language.md), [34](./34-cli.md).

Read: [rollout](../../rollout.md); [validation](../../validation.md); [completion](../../completion.md).

## Assignment

Integrate full TS composition, live local stack and staged native deployment/rollback path. Replace obsolete app pool controls only at their removal gate.

Proposed write scope: `orchestrator-owned deploy/workflows/Makefile/scripts/config/docs`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `deploy/router/worker/start/nginx; CI/deploy; scripts/dev.py user diff`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Local integrated editor/match/interview/judge scenarios; role fences/migration order/rollback rehearsal; preserve user script changes; no production dispatch.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
