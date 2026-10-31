# 10 Product identity and access policy

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [06](./06-db-primitives.md), [07](./07-question-model.md).

Read: [auth](../../auth.md); [canonical-owners](../../canonical-owners.md); [primitives](../../primitives.md).

## Assignment

Centralize managed/guest principal mapping, strong-auth/capability policy, product identity binding, shared distributed limits and explicit local-only identity.

Proposed write scope: `modules/identity/ modules/access/ and assigned postgres identity/access repositories`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `identity verifier/guest; httpapi guests/server; postgres identity/guest controls`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

HTTP/socket-ready policy matrix covers host/admin/guest/private scopes, revocation and service outage; no provider policy duplicates.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
