# 04 Hono and workspace foundation

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [01](./01-drizzle-spike.md), [02](./02-auth-spike.md), [03](./03-vectors.md).

Read: [http-runtime](../../http-runtime.md); [architecture](../../architecture.md); [primitives](../../primitives.md).

## Assignment

Wire strict ESM, Hono factories, error mapping, neutral dependency composition, Node/workerd smoke harness and import boundaries. Establish actual packet test commands.

Proposed write scope: `orchestrator-owned manifests/config/app mount and runtime skeletons`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `httpapi/server.go; package.json; existing vp configs`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Same health/error/middleware fixture on Node/workerd; no placeholder product success routes; dependency checks runnable.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
