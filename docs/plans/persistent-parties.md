# Persistent parties and latest-match review

Ledger: https://github.com/ethan-ngai/quorem/issues/598

## Product contract

A party is the persistent lobby. A match is one competitive round with fixed participants and settings. Completing a round returns the party to its lobby; it does not dissolve the group.

Confirmed: automatic post-match code sharing between that round's participants, controlled by a lobby setting. **Share code after match** defaults on. The host can change it before the next round; changing it clears readiness. Capture the policy at round start. Later changes affect future rounds only. Own-code review is available with sharing either on or off.

## Party lifecycle

- One active party membership per account or guest identity. Joining another party requires an explicit Leave first.
- Party identity, invitation and membership survive rounds and navigation within Quorem.
- Host chooses settings and queues the initial round after everyone is ready. Mode rules validate size and eligibility; Showdown and Free-for-all retain their current competitive rules.
- Completing a round clears readiness once and exposes its results. Each player can Ready up directly from results or from the lobby. Those are two views of the same authoritative readiness state.
- When every current party member is online, eligible and ready after a round, start the next round automatically with the current lobby settings. A short cancellable countdown exposes who is ready and allows Unready. Membership/settings changes cancel it and clear readiness.
- Return to lobby changes the view; it preserves membership and readiness. Reviewing code also preserves membership; it never readies the viewer automatically.
- Ready and queued players can Unready until the round-start transaction commits. Duplicate commands and reconnects cannot create duplicate rounds.
- Party membership cannot join an already-started round. New invitees wait in the lobby for the following round. They receive no current-round source or private problem access.
- Explicit Leave is immediate. During a round, round departure follows the existing forfeit rules. Leaving from post-match review does not erase the viewer's bounded own-code review access.
- Host departure transfers leadership to the longest-standing online member. If nobody is online, retain the party during the disconnect grace period. The host can explicitly Disband while in the lobby; require confirmation. Do not terminate an active round by disbanding its party.

## Presence and cleanup policy

Recommended initial thresholds, centralized as domain configuration:

| Event | Policy |
| --- | --- |
| Platform presence | Authenticated, lightweight heartbeat every 20 seconds; lease lasts 90 seconds. Aggregate across every Quorem tab/device for that identity; a live authenticated match/interview window lease also proves platform presence. |
| Navigation / closing one tab | Membership stays while another platform lease is alive. |
| All leases stale | Mark member offline and clear their readiness. Block a new round from including them. |
| Reconnect within 5 minutes of the last platform heartbeat | Restore membership and current state; readiness remains cleared. |
| Five minutes without any platform heartbeat | Remove the member from the party. Transfer host if needed. |
| Everybody absent | Disband once the last member's five-minute grace expires. Revoke party invitations and release memberships. |

Measure presence across the platform, not solely through the match socket. Existing match/interview socket leases last 30 seconds and establish scoped presence; they do not prove someone has left Quorem. A browser unload event is only an optimization. PostgreSQL timestamps, renewable per-window leases and scheduled reconciliation are authoritative.

Background throttling and mobile suspension get the grace window; multiple tabs must not race to remove one another. Presence loss clears readiness, including during a requeue countdown. Do not collect source, navigation paths or keystrokes for presence.

An active round has independent, fixed participants. Expiring a party seat does not silently decide the round or discard admitted judge work. Existing round deadlines and explicit forfeit rules still settle it. Reconnecting former party members can recover their already-started round, but must rejoin a live party to enter another round. Party cleanup may run while an independent round finishes.

Connected but inactive tabs are a separate AFK concern. Initial scope uses platform presence rather than introducing activity surveillance or an arbitrary hard party lifetime.

## Latest-match review

- The completed workspace stays mounted behind the result dialog. Freeze the match clock, conduct monitoring, editing and new match admissions; already-admitted judging may finish. **Review code** dismisses the dialog in place; **Results** reopens it.
- Own view restores the latest saved match draft. Identify the exact last submitted source and its verdict separately when it differs. Recover unsaved local edits through the existing recovery mechanism.
- With sharing enabled for that round, participants can select each opponent's last admitted Submit source. Show No submission when absent. Do not share unsubmitted opponent drafts.
- Review stays unavailable until the entire round has settled, including when the viewer forfeits early. Finishing one's own participation never grants early access to a still-running opponent.
- Only participants of that completed round may read its shared sources. Later party joiners and nonparticipant spectators gain no access. Apply authorization on every read; never depend on hidden UI.
- Own code is readable regardless of the sharing setting. Opponent reads use the round's frozen sharing policy. Enabling sharing in a later lobby cannot expose a previous private round.
- Support Your code, an opponent selector, and Compare inside the same problem/editor/results composition. Review edits belong to viewer-owned experimental drafts, isolated per round, source participant and language. Preserve both the original submissions and the viewer's match draft. Side-by-side editors and same-language diff use the shared CodeMirror/language/theme owners; different languages retain side-by-side comparison.
- Run and Submit execute the selected experimental draft, with the target named beside the actions and its results below. Review jobs use normal execution limits; they never enter match scoring, change original submissions or grant practice solve credit. Changing the active editor cannot retarget an already-admitted job. Local drafts survive view/layout changes.
- Expose one immediately previous round per viewer. Access ends when that viewer starts another competitive round, or 24 hours after completion, whichever comes first. Leaving/disbanding a party does not immediately destroy that bounded review window.
- Retention is enforced on the server. Clear stale review pointers and source retention holds after expiry; continue using existing finite submission retention for independently retained submission records. Add no match-history archive or question-version snapshot system.
- A dedicated completed-round projection returns only permitted submitted code, public results and problem content. Review execution uses a distinct viewer-owned workspace, authorized through that same latest-round/sharing boundary on every operation. It grants no opponent workspace access or additional private-case visibility. Expiry blocks new review work; original results remain immutable.

## Architecture and implementation order

1. Separate persistent party identity/membership/settings from single-round matches. Keep fixed round participants, admitted inputs and judging outcomes under their existing owner. Replace the current single-round reservation semantics with explicit party membership and per-round participation.
2. Add platform-wide renewable presence and durable party reconciliation. Keep provider-neutral policy in modules and PostgreSQL transaction/deadline behavior in adapters. Reuse established event/idempotency/scheduling primitives.
3. Add ready state/version, host transfer, round-start countdown and idempotent queue transitions. Freeze selected settings, code-sharing policy, participants and any future team membership at round start. Generic completion outcomes remain viewer-relative.
4. Add authorized latest-round review projections and bounded retention. Preserve admitted source identity; obtain code from the existing authoritative draft/submission owners rather than duplicating it into event payloads.
5. Update lobby, global party return affordance, result actions and code comparison. Shared primitives own pending/disabled/error/focus behavior. Result and lobby ready controls operate on the same state.

Guest sessions currently end with a match. Persistent parties require live party-scoped guest authorization and per-round access checks, bounded by host entitlement and expiry. Replace that lifecycle deliberately; never reactivate an expired or revoked guest session.

## Required verification

- Multi-window presence, page navigation, transient loss, reconnect boundary, abandoned party cleanup and host transfer.
- Host leave versus disband; joining/leaving during a round; party expiry while judging continues.
- Simultaneous ready/unready/settings/membership changes and exactly one new round after all-ready.
- Shared setting changes reset readiness and cannot alter an already-started round's disclosure policy.
- Winner/loser/team/observer outcome normalization without mode-specific celebration gates in primitives.
- Early forfeit, late judge completion, absent submissions, new party members, forbidden opponent reads and expired review links.
- The next round and 24-hour cap invalidate review access; review has no live execution or draft mutation capabilities.
- Live two-account and guest flows; disposable PostgreSQL integration tests use a database separate from development.

## Implementation

Implemented in the party lifecycle, platform presence, dedicated completed-round review projection, and shared lobby/results controls. The old single-round lobby mutation routes are removed. Winner rows show authoritative elapsed round time. Review restores browser-local drafts; opponents expose only their final admitted submission.

Disposable PostgreSQL tests cover presence, eligibility, readiness races, expiry, guest authorization and review retention. The mandatory native SQL runtime validation also exercises two accounts and a guest through two rounds, frozen sharing policy, automatic requeue, host transfer and disbanding.
