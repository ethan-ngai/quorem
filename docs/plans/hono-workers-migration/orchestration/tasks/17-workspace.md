# 17 Workspace identity and Odyssey reads

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [13](./13-catalog.md), [10](./10-identity-access.md).

Read: [primitives](../../primitives.md); [canonical-owners](../../canonical-owners.md).

## Assignment

Port workspace creation/read and Odyssey progress/reset using immutable owner/language/context constraints and shared public projection.

Proposed write scope: `modules/workspace/; assigned workspace/odyssey repositories`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `httpapi workspaces/odyssey; postgres workspaces/odyssey feedback`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Owner/context/language constraints and concurrent reset/replay behavior; browser-only drafts remain browser-owned; unlocked public examples only.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
