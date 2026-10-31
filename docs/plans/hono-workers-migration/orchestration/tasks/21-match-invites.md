# 21 Match invitations guests and selection

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [20](./20-match-core.md).

Read: [auth](../../auth.md); [extensions](../../extensions.md); [realtime](../../realtime.md).

## Assignment

Port invite rotate/preview/join, guest removal/budgets, current-match discovery and workspace-language behavior. Reuse authorized SQL candidate/read contracts.

Proposed write scope: `modules/matches/invitations/ selection/; matching postgres dirs`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `invite preview/guest/join/current_match; match languages/private question tests`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Revoked invites/private-library visibility/guest limits/selection constraints pass; safe stream snapshot interfaces; no semantic search implementation.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
