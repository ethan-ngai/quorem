# 31 Node portability socket adapter

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [30](./30-socket-protocol.md).

Read: [realtime](../../realtime.md); [http-runtime](../../http-runtime.md).

## Assignment

Host shared protocol through Node WebSockets and current supported fanout adapters. Preserve distributed presence and authority checks.

Retain AWS AppSync safe-notice publication/subscription and Cloudflare relay compatibility where still consumed. Validate signed/authenticated protocol mapping, partial failures, bounded reads, reconnects and redaction through fixtures; no browser publication authority or live AWS rollout.

Proposed write scope: `apps/api/src/runtime/node/socket/ and conformance tests`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `current Go WS transport; Node language gateway ws patterns`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Two-instance PostgreSQL-backed protocol suite and credential rotation/revocation; no Cloudflare credentials or imports needed.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
