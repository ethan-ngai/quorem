# Multiplayer — after editor foundation

MVP: private invite-based Showdown (two contestants) and Free-for-all (two to eight), one immutable problem. Host chooses a specific public problem or random selection from one or more difficulty pools. Random identity is revealed only at start. Public matchmaking/parties/shared editing deferred. Identity, wire fields and limits are in auth.md, contracts.md and operating-defaults.md.

Confirmed rules: earliest server-received correct submission wins; host selects 15/30/45/60 minutes, default 30. At deadline compare highest hidden-test passed count per player, drawing on equality. Disconnect does not stop the clock or cause automatic forfeiture; reconnect until deadline, explicit forfeit ends participation. Expose connection/readiness, submission status, best passed-test count; source remains private.

Invite: hashed 256-bit token, 24-hour expiry; authenticated join and atomic two-seat claim. One active match per user. No problem identity before start. Host setting changes clear all ready flags, including mode, pool, specific problem and rule edits. Switching to Showdown with more than two participants is rejected. Pre-start host leaves: cancel; guest leaves: free seat. Active departure is disconnect unless explicit forfeit. Empty difficulty pool returns configuration error, never substitutes difficulty.

## Planned match visibility settings

When creating a match, the host can enable or disable hiding test cases. When hiding is enabled, offer a separate toggle to enable or disable showing stdout from those cases. Defaults: hide test cases, hide stdout. These controls are confirmed requirements, not implemented yet.

Persist the visibility policy on the match, show it to both participants before readiness, and freeze it at start. Pre-start changes clear both ready flags. Enforce the policy in server responses and realtime events, not only the UI. Showing stdout while hiding cases permits contestant-printed input to appear; hiding stdout must omit the stream entirely. Keep stderr and arbitrary diagnostics private for hidden cases; only time-limit failures reveal a reason. Revealed cases use the normal input/expected/actual presentation.

## Lifecycle

waiting → ready → active → finalizing → completed; cancelled for pre-start abandonment. Showdown has two seats and starts when both ready; Free-for-all has up to eight seats and requires an explicit host start with at least two players, all ready. Join and readiness transitions atomic. Server fixes problem version, selected duration, start/deadline. Clients display estimated time from server timestamps; server decides whether submission is eligible. Finalizing represents pending eligible submissions, not permission to accept new work after deadline.

Completion transaction updates once and records event. Rank correct submissions by actual database time sampled after taking the match lock and locked total-order sequence. Use `clock_timestamp()`, never transaction-start `now()`. Eligible iff admission is strictly before deadline; exact-deadline/lock-delayed late requests rejected. Equal timestamps ordered by sequence. Test-only random source injectable.

Before declaring earliest correct, resolve earlier eligible opponent jobs that could change the winner. Earlier uncertain work from the accepted candidate's own account cannot change the winner. At deadline reject new submissions, finish eligible work and compare best counts; no-submission score zero. Infrastructure failure never scores zero. Finalization: up to two minutes, then no contest if unresolved eligible work could alter outcome. Window begins at deadline or first correct candidate awaiting earlier work; persists across restart/retries. Freeze overdue uncertainty before applying a late completion. Finalize sooner if outcome certain. One-job-per-user includes Run; Run never scores. Late verdicts may update owner history but never completed outcome/frozen progress.

Reconciliation cancels waiting/ready matches at invite expiry and releases reservations; active matches expire by persisted deadline. Start/expiry/admission/forfeit/completion serialize on the aggregate; cleanup cannot release a reservation belonging to a newer match.

## Realtime

Private per-match subscription authorized for participants. Broadcast state versions, readiness, safe submission status/best hidden-test count, and outcome; never opponent source or hidden tests. Presence is advisory; durable participant state and match outcomes live in PostgreSQL. Reconnect gets authoritative snapshot; missing events never imply automatic forfeiture. Explicit forfeit requires an authorized idempotent command. Showdown immediately concedes; Free-for-all excludes that contestant and continues until one remains or the outcome settles. Pending forfeited submissions cannot reverse the result. Serialize forfeit/completion races in the same match transaction. Replayed forfeits cannot change an already completed outcome.

Server performs match transition and submission eligibility checks in transactions with concurrency protection. PubSub delivers updates rather than owning the game. Scheduled expiration/reconciliation handles matches even if browsers disconnect and API instances stop.

## Acceptance

- Two browser identities create/join/start/submit/complete the same local match.
- Third join, duplicate ready, concurrent completion, unauthorized subscription, replayed commands handled.
- Reconnect, out-of-order/duplicate/missing events, worker delay, deadline race produce the confirmed outcome.
- Match result survives API/realtime restarts; opponent source remains private.

Extension seams: participant collections/configurable rules; ProblemSelector starts with uniform random selection and test-only seeded randomness. Future shared editing uses a separate CRDT protocol, not keystrokes in match events.

## Browser-observed host rules

Each of clipboard and window-focus rules offers Allow, Warning, 30-second cooldown, or Announce to lobby. Defaults allow both. Restricted clipboard events are cancelled in the statement/editor. Blur and hidden events count once per absence. No clipboard content, source, or navigation target is reported. Cooldown reports are serialized by the match lock, do not stack, and block server admission for Run and Submit. Announcements retain at most twenty events; reports are throttled. Policies freeze at start.

These are browser-observed conduct controls, not tamper-proof anti-cheat. A modified client can bypass observation. Timing, scoring, membership, and admission remain server-authoritative.
