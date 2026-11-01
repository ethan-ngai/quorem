# 32 Cloudflare browser Durable Objects

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [30](./30-socket-protocol.md).

Read: [realtime](../../realtime.md); [http-runtime](../../http-runtime.md).

## Assignment

Implement browser-capable DO gateway separate from old private relay, minimal hibernation attachments, opaque grants and authorized rehydration.

Proposed write scope: `assigned browser gateway DO classes/runtime adapters; no shared ingress edits`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `apps/realtime-cloudflare relay; deploy DO lifecycle; browser sockets`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Actual workerd hibernation/wake/auth expiry/revocation/coalescing/backpressure tests; no raw credentials/private snapshots in attachments.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
