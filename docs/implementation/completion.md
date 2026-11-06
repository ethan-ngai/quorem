# Completion feedback

Issue: https://github.com/ethan-ngai/quorem/issues/594

## Shipped behavior

- Practice: accepted, completed **Submit** opens the shared completion dialog. Compact success heading, problem with colored difficulty text, passed cases, language logo with accessible tooltip. Back to editor is primary; More problems is secondary. Each distinct successful submission qualifies; Run never counts as a solve.
- Odyssey: await authoritative progress refresh. Accepted intermediate solo submissions fire confetti without interrupting editing. The completed Odyssey opens the dialog only in practice; competitive celebrations wait for the settled winner, including Odyssey rounds.
- Interviews: accepted shared submissions celebrate for both candidate and interviewer, without a modal or additional private-case reads. Failed submissions remain quiet.
- Competition: preserve settled outcomes, forfeits, guest exits and standings. Winners get confetti; losses, draws and cancellations retain neutral feedback. Mode uses an accessible icon; difficulty uses the standard colored word. The clock shows the round limit, and difficulty reflects the played problem. Scores appear once in the standings. Review results dismisses; New match opens existing creation. Guest sessions end normally.
- Restored practice results deduplicate by submission ID within the browser session. Storage failure falls back to component-local deduplication.
- Shared `SessionDialog` owns focus, Escape, dismissal and entry/exit motion. `CompletionDialog` owns summary composition; `Celebration` owns short side bursts. Confetti lazy-loads canvas-confetti: short paired side bursts with a wide 110-degree shooting arc, slower launch and origins inset behind the popup, gravity, drag and tumbling. Each celebration owns and cancels its canvas; reduced motion skips loading and firing. Theme tokens supply particle colors.

## Shared audience contract

`CompletionOutcome` is viewer-relative: success, loss, observer, pending or neutral. `Celebration` owns eligibility: success and observers of a successful event may celebrate. Loss, pending and neutral never launch particles; a transition to an ineligible outcome cancels an active animation. `CompletionDialog` forwards this contract, without a separate celebration flag. `CompletionOutcomeIcon` owns result icons/tones: losses use a red X in both dialogs and result pages.

Modes normalize their domain result at the boundary. `matchCompletionOutcome` handles current individual matches; a future team adapter supplies the same outcome from team membership. Primitives never inspect modes, player IDs or teams. Accepted-submission event detection and browser-session deduplication are shared between solo workspaces and interviews.

## Next-round design

The competitive demo previews two future actions, explicitly disabled and labeled as upcoming. Production exposes New match until the server lifecycle exists. The follow-on party, presence and bounded code-review design is [persistent parties](../plans/persistent-parties.md), tracked in [#598](https://github.com/ethan-ngai/quorem/issues/598).

1. **Return to lobby**: same participants, host and settings; clear readiness and previous results; allow settings changes before starting.
2. **Quick requeue**: everyone readies from results or the lobby; the same party starts another round with its current settings after a cancellable countdown. Show pending/waiting states, prevent duplicate starts, and handle departures/host disconnects.

Both actions require authoritative membership and round transitions, fresh question selection, renewed guest authorization where needed, idempotent commands and reconnect recovery. Never reactivate an expired guest identity or reuse completed workspace/result state. Keep one next-round action area in the summary; avoid a separate rematch modal.

## Local demo

`http://127.0.0.1:5173/dev/completion` (Vite development only).

Practice, competition win/loss, interview observer, Odyssey intermediate/finale, replay, theme toggle; fixture-only, no provider credentials. Close the dialog to switch flows. Future controls are illustrative; demo navigation buttons dismiss the dialog.
