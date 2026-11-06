# Completion feedback

Issue: https://github.com/ethan-ngai/quorem/issues/594

## Shipped behavior

- Practice: accepted, completed **Submit** opens the shared completion dialog. Compact success heading, problem with colored difficulty text, passed cases, language logo with accessible tooltip. Back to editor is primary; More problems is secondary. Each distinct successful submission qualifies; Run never counts as a solve.
- Odyssey: await authoritative progress refresh. Accepted intermediate solo submissions fire confetti without interrupting editing. The completed Odyssey opens the dialog only in practice; competitive celebrations wait for the settled winner, including Odyssey rounds.
- Interviews: accepted shared submissions celebrate for both candidate and interviewer, without a modal or additional private-case reads. Failed submissions remain quiet.
- Competition: preserve settled outcomes, forfeits and standings. Winners see Victory with a yellow trophy and get confetti; losses use a red X, while draws and cancellations remain neutral. Mode uses an accessible icon; difficulty uses the standard colored word. The clock shows the round limit. The subtitle names the workspace problem. The winner row uses a yellow crown and a clock beside actual elapsed round time. Scores appear once. Review code and Return to lobby share a navigation row above the full-width Quick ready action. Each action has a semantic icon. A red Leave lobby icon in the header removes membership without dismissing results or losing review access. The separate X only dismisses the summary. Party-scoped guests remain in the lobby across rounds.
- Restored practice results deduplicate by submission ID within the browser session. Storage failure falls back to component-local deduplication.
- Shared `SessionDialog` owns focus, Escape, dismissal and entry/exit motion. `CompletionDialog` owns summary composition; `Celebration` owns short side bursts. Confetti lazy-loads canvas-confetti: short paired side bursts with a wide 110-degree shooting arc, slower launch and origins inset behind the popup, gravity, drag and tumbling. Each celebration owns and cancels its canvas; reduced motion skips loading and firing. Theme tokens supply particle colors.

## Shared audience contract

`CompletionOutcome` is viewer-relative: success, loss, observer, pending or neutral. `Celebration` owns eligibility: success and observers of a successful event may celebrate. Loss, pending and neutral never launch particles; a transition to an ineligible outcome cancels an active animation. `CompletionDialog` forwards this contract, without a separate celebration flag. `CompletionOutcomeIcon` owns result icons/tones: losses use a red X in both dialogs and result pages.

Modes normalize their domain result at the boundary. `matchCompletionOutcome` handles current individual matches; a future team adapter supplies the same outcome from team membership. Primitives never inspect modes, player IDs or teams. Accepted-submission event detection and browser-session deduplication are shared between solo workspaces and interviews.

## Next round and review

The persistent lobby and bounded code-review contract is [persistent parties](../plans/persistent-parties.md), tracked in [#598](https://github.com/ethan-ngai/quorem/issues/598).

1. **Return to lobby**: preserve membership, settings and readiness. Navigation never readies or unreadies a player.
2. **Ready up**: everyone readies from results or the lobby; the same party starts another round after a cancellable five-second countdown. Both views use the same per-member readiness indicators and allow Unready. In results, each indicator sits immediately left of its score; new members appear in a separate Joined lobby section. Only an active countdown gets a status line. The root party query refreshes across clients every three seconds; both actions invalidate the same current-party state.
3. **Review code**: dismiss the dialog over the retained workspace. Keep original match submissions immutable; experiment in viewer-owned drafts with Run/Submit targeting the selected editor. Experimental verdicts never change match scores or solve credit. Opponent submissions become available after the entire round settles, subject to the round's frozen sharing policy. Split editors and same-language diff preserve local drafts. Access expires at the next competitive round or 24 hours after completion. **Results** reopens the summary.

Review keeps one compact author/language toolbar with direct Single, Split and Diff choices. Split panes share aligned language/name headers; the editable copy uses a pencil, the reference a lock and a swap action. Original submissions open in an anchored preview. Narrow screens stack the editors. Layout changes retain the mounted editor, draft, selection and undo history.

Authoritative membership, renewable platform presence, idempotent commands and scheduled reconciliation own round transitions. Never reactivate an expired guest identity or reuse completed workspace/result state.

Finishing freezes the existing match workspace rather than replacing its background with a results page. Stop the match clock and conduct monitoring, disable match edits and new admissions, and retain already-admitted judging. Popup-free celebrations launch inward from just beyond the viewport's left and right edges; dialog celebrations retain their behind-popup origins.

## Local demo

`http://127.0.0.1:5173/dev/completion` (Vite development only).

Practice, competition win/loss, interview observer, Odyssey intermediate/finale, replay and theme toggle; fixture-only, no provider credentials. Close the dialog to switch flows. Competition actions demonstrate readiness, the lobby and read-only comparison with illustrative code.
