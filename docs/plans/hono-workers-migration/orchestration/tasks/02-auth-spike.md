# 02 Auth runtime feasibility

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [00](./00-baseline.md).

Read: [auth](../../auth.md); [database](../../database.md).

## Assignment

Verify pinned Better Auth/Drizzle adapter, existing hash verification/new-hash rollback, passkeys, crypto budget, image processing and HTTPS mail choices.

Proposed write scope: `isolated auth runtime probes`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `apps/auth/src/auth.ts; profile.ts; infrastructure.ts; registration.ts`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Executed workerd report with selected adapters; same old hashes and sessions; unsupported native addon/SMTP paths isolated.

Use existing fixture/test tools or isolated spike commands; record exact commands and results. Do not depend on foundation packet 04, which consumes these reports. Add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
