# 11 Better Auth Drizzle persistence

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [06](./06-db-primitives.md), [10](./10-identity-access.md), [02](./02-auth-spike.md).

Read: [auth](../../auth.md); [database](../../database.md).

## Assignment

Switch auth owner to verified Drizzle adapter and schema mapping; remove import-time environment/pool initialization. Preserve plugin records, keys, cookies and identity semantics.

Proposed write scope: `apps/auth/src/auth factory/database composition and auth persistence tests`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `apps/auth/src/auth.ts database.ts session/profile/registration flows`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Existing accounts/passwords/passkeys/social/session assurance and revocation work in Node/workerd; no implicit search_path reliance.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
