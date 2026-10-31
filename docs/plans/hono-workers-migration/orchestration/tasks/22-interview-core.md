# 22 Interview membership and lifecycle

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [14](./14-authoring.md), [10](./10-identity-access.md), [15](./15-dispatch.md).

Read: [auth](../../auth.md); [primitives](../../primitives.md); [realtime](../../realtime.md).

## Assignment

Implement create/list/invite/join/member changes/close/delete with one canonical membership policy, atomic epoch/version notices and preserved historical references.

Proposed write scope: `modules/interviews/lifecycle/; postgres/interviews/lifecycle/`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `interviews lifecycle/access/members/guest lifecycle; invite routes`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Host/member/guest/revocation/concurrent lifecycle matrix; source/private fixtures never appear in invite/public DTOs.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
