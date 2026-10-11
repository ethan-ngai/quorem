# Contracts

`openapi/api.json` is the source of truth. Run `vp run contracts:generate` after edits; commit generated types. `vp run contracts:check` validates command/event fixtures and rejects generation drift.

Use `createApiClient({ identity: "alice" })` from `@quorem/contracts`. `alice`/`bob` headers apply only to local development. Calls use canonical workspace IDs and required execution idempotency headers. Revisions and sequences are decimal strings.

Events use public safe snapshots. Shared Go jobs and public Python declarations live in `internal/execution`. Runtime/harness revisions are immutable; runner and language service consume the same node declarations.
