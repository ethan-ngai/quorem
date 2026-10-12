# Match modes

Issue #28; depends on #27.

## Behavior

- Shared global navigation and centered creation dialog; Showdown and eight-seat Free-for-all.
- Hosts switch modes before start; Showdown requires at most two seated players. Changed settings clear readiness.
- Always-visible Difficulty segments whose adjacent selections share one continuous background constrain searchable problem selection in an anchored popover and Random. Incompatible selected problems reset to Random. Selection freezes at start.
- Host rules appear only in the lobby; creation retains mode, difficulty, problem and duration.
- Free-for-all starts explicitly by its host after two or more players all ready. First correct wins; deadline uses highest passed count, drawing on a tie.
- Forfeit excludes that player, including pending results. Last remaining player wins; reservations remain until completion.
- Independent clipboard/focus actions: allow, local warning, or public announcement. No clipboard/source/navigation content sent. Blur/hidden deduplicate; announcements retain twenty events.
- Migration 062 preserves Showdown matches, cached snapshots and legacy command replay; local Charlie/Dana fixtures enable four-player testing.

## Limits

- Browser conduct observation can be bypassed by a modified client. These rules cannot enforce OS-level focus or clipboard access.
- Invite-only FFA; public matchmaking, parties and points remain deferred.
- Hidden-case visibility settings remain planned in multiplayer.md.

## Validation

- Contract/schema, runtime snapshot, conduct-event deduplication and match-state checks.
- Disposable PostgreSQL tests cover three-player start, win/deadline, forfeits, readiness resets, seat holes and bounded announcements.
- Browser at 711×771: unified creation, specific/multiple-pool selection, mode switch resetting readiness, explicit FFA start and blocked Run/Submit after copy.
- Real Docker judge completed the isolated Charlie/Dana FFA with first_correct; opponent snapshot omitted the winner workspace ID.
