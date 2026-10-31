# 09 Private execution contracts

[Plan index](../../README.md)

Model: `gpt-6.1-terra`; reasoning: `medium`. Dispatch only after orchestrator fills [exact assignment](../task-template.md). Implementation authorized for development; production/main promotion remains separately gated.

Prerequisites: [08](./08-question-codecs.md).

Read: [execution](../../execution.md); [codecs](../../codecs.md).

## Assignment

Create runtime/harness registries, job/attempt/frame/checkpoint codecs and pure contracts shared by API and runner. No process or transport implementation.

Proposed write scope: `packages/execution/src/ and conformance fixtures`. Orchestrator replaces this with an exclusive file list; shared manifests/exports/schema/migrations/runtime mounts remain centrally owned unless explicitly delegated.

Inspect analogues and their consumers: `internal/execution; runner/engine remote framing; worker checkpoint aliases`. These are discovery pointers, not exhaustive port specifications; inspect the actual owning source before changes.

## Acceptance

Existing revision/frame/checkpoint vectors agree; malformed/truncated/oversize frames rejected; private package cannot enter browser bundle.

Use actual commands established by foundation packet 04; add focused tests proving the listed invariants. Real PostgreSQL/workerd evidence required where mocks cannot establish behavior. Test DB/schema and ports must be unique/disposable.

## Handoff

Return completed commit(s), affected interfaces/consumers, exact checks/results, unresolved limitations and obsolete paths removed. No outside-scope edits, copied policy/codecs, new KV/search functionality or stub success. Follow [integration](../integration.md).
