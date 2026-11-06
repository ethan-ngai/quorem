# Social

Issue [#626](https://github.com/ethan-ngai/quorem/issues/626).

## First release

Automatic nemesis discovery and authenticated player profiles. No manually selected rivals or mutual requests. PostgreSQL match outcomes remain authoritative; projections require no second result ledger.

- Social: up to 20 rivals from the last 90 days, at least three completed Showdowns together. Order by losses to opponent, encounters, latest encounter, stable participant ID. First row is your nemesis; selection can be asymmetric. This is a rivalry heuristic, not a skill rating.
- Records: wins/draws/losses; forfeits count according to the authoritative outcome. Exclude cancelled/no-contest/unstarted matches, invalid winners, guests, disabled accounts and malformed participant counts. Free-for-all is excluded until ranking semantics are designed.
- Players: case-insensitive literal display-name/username search, 20 per page. Canonical globally unique @username distinguishes display names; UUIDs are routing keys only; internal identity/session/email never leave this projection.
- Profiles: identity and 90-day Showdown aggregates; head-to-head is always from the viewer's perspective. No opponent source, submissions, question identifiers, private room links or third-party rival lists.
- Existing account identity is discoverable to signed-in accounts. Anonymous/guest reads denied; disabled accounts disappear. This release does not add profile biographies or privacy preferences.
- Shared eligibility query owns all record calculations. Snapshot transactions recheck persisted caller authority, bound execution time, and prevent cross-query inconsistency. Responses are private/no-store.

## Later phases

1. Global leaderboard: decide ranked eligibility, rating algorithm, seasons, minimum participation and anti-farming policy. Private custom matches should not automatically become ranked. Add an idempotent rating ledger keyed by completed match, versioned scoring rules and deterministic ties. Profile and leaderboard share one rating projection.
2. Friend groups: explicit invitations and membership authority, owner transfer/removal, leave/delete semantics and privacy controls. Group leaderboard filters the same global ranking projection before pagination; no second scoring algorithm. Parties remain transient play coordination, separate from social group membership.
3. Richer profiles: deliberate public/private field controls and stable handles; maintain authorization before search/ranking pagination.

## Validation

Transport authorization and validation; disposable PostgreSQL eligibility, ordering, pagination, redaction and perspective tests; typed contract generation; frontend state tests; live Vite desktop/narrow and light/dark checks. Hosted deployment is separate.

Validation completed locally: 705 web tests passed (two skipped), seven social route/PostgreSQL tests, two HTTP inventory tests, two database migration/checksum tests; API/web/database typechecks and contract generation checks passed. Repository lint: zero errors, 19 pre-existing warnings; focused Social lint clean. DESIGN.md lint: zero errors, one existing primary-color format warning.

Live Vite from the Social worktree: `http://127.0.0.1:5189/social`, using isolated fixture identities and PostgreSQL. Verified desktop/390px, light/dark, search, page reset, profile navigation, empty search and keyboard retry after revoked visibility. Shared table motion retains existing reduced-motion behavior; reduced-motion emulation and hosted/load validation were not run. Migration `079_social_match_lookup.sql` adds the account-to-match lookup index; no production migration/deployment performed.

Design audit and username ownership: [Social design audit](../implementation/social-design-audit.md).
