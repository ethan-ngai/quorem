# Factions

Private party lobbies support 2–4 teams within the eight-player limit. Players choose teams; hosts can move players or auto-balance. Uneven teams are allowed. Changes clear readiness. Starting requires every player assigned and at least two occupied teams; the round freezes membership.

Each team shares one CodeMirror document, cursor presence, workspace, scoring subject, assistance grants, penalties, and submission cooldown. Lobby/readiness controls and the coding workspace remain shared with other modes. Interview document synchronization, presence, change decoding and version-fenced Odyssey method insertion are reusable primitives.

Paid submissions/reveals, language changes, starter resets and concession require a fixed-roster strict majority. The proposer votes yes. Ballots last 30 seconds; disconnects do not lower the threshold. Rejected, cancelled or expired votes incur no cost and have a five-second retry delay. Free runs/submissions/reveals remain immediate; behavioral penalties apply automatically.

The server freezes the action, source, rule version and exact cost. Majority execution and charging share one transaction. Paid-action approval is an internal argument, never an HTTP input. Editing continues during submission votes; destructive document changes require the original epoch/version. Switching languages creates/reuses an immutable-language workspace and replaces the shared document epoch. Opponents cannot read team documents, votes, presence or results. Post-round code sharing still respects lobby settings; teammates retain shared review access.

Votes use a persistent nonmodal toast: explicit costs, tally, deadline, approve/reject, proposer cancellation and recoverable minimization. Frozen submitted code can be inspected without moving editor focus. Expired actions disable locally; the server owns the deadline.

Transport: authenticated team HTTP endpoints under `/v1/parties/:id/teams` and `/v1/matches/:id/team`. Document pulls poll every 750ms while mounted; snapshots poll every second. Presence and read-only pulls do not create durable idempotency receipts. Document writes and vote actions do. Judging dispatch uses the existing durable execution intent and post-commit wake.

Migration: `080_factions.sql`. Local verification uses disposable `quorem_factions_test` via `QUOREM_FACTIONS_TEST_DATABASE_URL`; schema parity uses the separate `quorem_hono_schema_test`. Never point truncating tests at development data.

Ledger: [#622](https://github.com/ethan-ngai/quorem/issues/622).

Local visual fixture: `factions-preview.html` renders the real `PartyPage` with mock-only data. Run the usual Vite dev server; this separate HTML entry is not part of the production application.
