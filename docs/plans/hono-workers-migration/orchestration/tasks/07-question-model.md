# 07 Canonical question model and starters

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [04](./04-foundation.md), [03](./03-vectors.md).

Read: [canonical-owners](../../canonical-owners.md); [codecs](../../codecs.md).

## Assignment

Extract canonical immutable question values, validation, constraints, signatures and language starters for API/judge/tool consumers. Reuse current schema.

Proposed write scope: `packages/questions/src/model/ validation/ starter/ plus tests`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `apps/api/internal/problems/{authoring,model,starter,method_documentation,constraints}.go; public question schema`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Golden authoring/starter/SQL/Odyssey validation parity; no independent second question schema or provider imports.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
