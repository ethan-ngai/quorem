# 12 Auth media mail and storage adapters

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [11](./11-auth-db.md).

Read: [auth](../../auth.md); [http-runtime](../../http-runtime.md).

## Assignment

Introduce only necessary image-processing composition; reuse email/storage ports. Isolate sharp/SMTP to Node; choose tested Worker media/mail/object adapters.

Proposed write scope: `apps/auth capability ports/adapters and tests; assigned Worker composition`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `profile.ts; infrastructure.ts; email/profile-storage adapters`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Image decode/limits/metadata/CAS/cleanup and mail error behavior preserved; missing capability fails configuration; no unconditional Node-native Worker import.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
