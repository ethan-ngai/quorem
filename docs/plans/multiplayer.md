# Multiplayer — after editor foundation

MVP: two independent contestants, one immutable problem, private invites. Host chooses difficulty; server randomly selects from that pool and reveals only at start. Public matchmaking/FFA/parties/shared editing deferred. Identity, wire fields and limits are in auth.md, contracts.md and operating-defaults.md.

Confirmed rules: earliest server-received correct submission wins; host selects 15/30/45/60 minutes, default 30. At deadline compare highest hidden-test passed count per player, drawing on equality. Disconnect does not stop the clock or cause automatic forfeiture; reconnect until deadline, explicit forfeit ends participation. Expose connection/readiness, submission status, best passed-test count; source remains private.

Invite: hashed 256-bit token, 24-hour expiry; authenticated join and atomic two-seat claim. One active match per user. No problem identity before start. Host setting changes clear both ready flags. Pre-start host leaves: cancel; guest leaves: free seat. Active departure is disconnect unless explicit forfeit. Empty difficulty pool returns configuration error, never substitutes difficulty.

## Lifecycle

waiting → ready → active → finalizing → completed; cancelled for pre-start abandonment. Exactly two distinct seats; join and readiness transitions atomic. Server fixes problem version, selected duration, start/deadline. Clients display estimated time from server timestamps; server decides whether submission is eligible. Finalizing represents pending eligible submissions, not permission to accept new work after deadline.

Completion transaction updates once and records event. Rank correct submissions by actual database time sampled after taking the match lock and locked total-order sequence. Use `clock_timestamp()`, never transaction-start `now()`. Eligible iff admission is strictly before deadline; exact-deadline/lock-delayed late requests rejected. Equal timestamps ordered by sequence. Test-only random source injectable.

Before declaring earliest correct, resolve earlier eligible pending jobs. At deadline reject new submissions, finish eligible work and compare best counts; no-submission score zero. Infrastructure failure never scores zero. Finalization: up to two minutes, then no contest if unresolved eligible work could alter outcome. Window begins at deadline or first correct candidate awaiting earlier work; persists across restart/retries. Finalize sooner if outcome certain. One-job-per-user includes Run; Run never scores. Late verdicts may update owner history but never completed outcome/frozen progress.

Reconciliation cancels waiting/ready matches at invite expiry and releases reservations; active matches expire by persisted deadline. Start/expiry/admission/forfeit/completion serialize on the aggregate; cleanup cannot release a reservation belonging to a newer match.

## Realtime

Private per-match subscription authorized for participants. Broadcast state versions, readiness, safe submission status/best hidden-test count, and outcome; never opponent source or hidden tests. Presence is advisory; durable participant state and match outcomes live in PostgreSQL. Reconnect gets authoritative snapshot; missing events never imply automatic forfeiture. Explicit forfeit requires an authorized idempotent command and immediately concedes any not-yet-completed match; pending submissions cannot reverse the result. Serialize forfeit/completion races in the same match transaction. Replayed forfeits cannot change an already completed outcome.

Server performs match transition and submission eligibility checks in transactions with concurrency protection. PubSub delivers updates rather than owning the game. Scheduled expiration/reconciliation handles matches even if browsers disconnect and API instances stop.

## Acceptance

- Two browser identities create/join/start/submit/complete the same local match.
- Third join, duplicate ready, concurrent completion, unauthorized subscription, replayed commands handled.
- Reconnect, out-of-order/duplicate/missing events, worker delay, deadline race produce the confirmed outcome.
- Match result survives API/realtime restarts; opponent source remains private.

Extension seams: participant collections/configurable rules; ProblemSelector starts with uniform random selection and test-only seeded randomness. Future shared editing uses a separate CRDT protocol, not keystrokes in match events.
