# Match rules and penalties

Issue: [#623](https://github.com/ethan-ngai/quorem/issues/623).

`packages/contracts/src/match-rules.ts` owns validated settings and presets. New lobbies use Balanced. Victory and lobby editing permissions are independent of the selected preset; customized policies display Custom.

| Preset     | Assistance | Paste   | Focus   | Submission policy                                          |
| ---------- | ---------- | ------- | ------- | ---------------------------------------------------------- |
| Casual     | Free       | Allowed | Allowed | Unrestricted                                               |
| Balanced   | Paid       | Notify  | Notify  | 10-second cooldown                                         |
| Strict     | Paid       | Penalty | Penalty | Cooldown; extra attempts cost after three free submissions |
| Tournament | Disabled   | Blocked | Penalty | Strict submission policy                                   |

Topics, complexity, and any hidden case have separate free/paid/disabled policies. Hosts can customize copy, paste, focus, cooldown, free submission allowance, and costs. Focus defaults to a three-second grace and one free warning. Browser observations are best-effort client signals; they cannot prove external assistance or prevent switching applications.

## Victory

Race uses server admission time plus cumulative time penalties incurred through that submission. A verified correct submission cannot finish before its adjusted time. Earlier unresolved eligible work can delay settlement; uncertainty lasting two minutes produces no contest. Adjusted times beyond the deadline are excluded, including from score fallback. At the deadline, the highest eligible passed-test count wins; equal counts draw. Equal correct adjusted finish times draw.

High Score always runs to the deadline. Each competitor's score is their highest verified test-pass percentage minus cumulative point penalties. Negative scores are retained. Equal scores draw. Time costs apply only in Race; point costs apply only in High Score. Typing remains available during cooldowns and pending finishes.

## Charging and privacy

`POST /v1/matches/{id}/rule-actions` without approval returns a quote, never private content. Approval supplies the exact `ruleVersion`, `seconds`, and `points`; the server recomputes these under the match lock. Hidden-case quotes select the requested case, or the next unrevealed case and return its `caseIndex`, which execution must repeat. Passed and failed cases are eligible. The result includes sealed input/expected output and the actor's actual result. Reopening the same case is free. Reveal announcements contain action and cost, not private case content.

Submission admission uses the same cost calculation and requires approval for paid attempts. Cooldown and costs are checked atomically with admission. Infrastructure-failed submissions no longer count toward charges, cooldown, or the free allowance.

`match_rule_events` records both acting user and competitive subject. Subject totals support individual players and shared team costs. One-time reveal grants use the resource key; private results live in `match_private_result_cases` and cascade with submission deletion. Normal result streams never expose those private result bodies; all match submissions omit per-hidden-case verdicts.

Settings lock when the match starts. Allowing everyone to edit lobby settings does not delegate host-only access/admission controls or permission changes. Settings changes reset readiness.

## Validation

Disposable PostgreSQL lifecycle tests cover paid reveal ownership, exact-cost approval, grant deduplication, hidden-verdict redaction, submission refunds/cooldown, shared subjects, and lobby permissions. Reconciliation tests cover delayed wins, deadline exclusion, High Score, ties, and unresolved work. Browser monitor tests cover grace periods, cleanup, and clipboard policies.
