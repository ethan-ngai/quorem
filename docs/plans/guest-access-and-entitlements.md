# Guest access, host budgets and internal privileges

Status: implementation plan. Ledger: [#83](https://github.com/ethan-ngai/quorem/issues/83). Practice sign-in popup: [#84](https://github.com/ethan-ngai/quorem/issues/84), implemented with this plan; remaining phases require implementation authorization. Related: authoring #37, hosted intelligence #69, infrastructure #15.

## Product contract

- Free accounts retain ordinary lobby hosting with signed-in participants and existing resource limits.
- Only hosts with `matches.host_guests` may enable account-free joining. Paid subscriptions and manual internal grants can provide this entitlement.
- Joining as a guest is free. Guest execution consumes the sponsoring host/room budget; resetting browser storage never resets that budget.
- Hosts always sign in. Guests cannot create rooms, administer accounts, enter ranked matchmaking, or execute in practice.
- Guest-enabled competitive rooms are initially unranked. Interview and classroom experiences reuse access/budget infrastructure but have distinct behavior and permissions.
- Admin authoring permissions, premium benefits and resource overrides are separate. No `admin => bypass all checks` rule.
- Monthly guest-room counts are optional commercial allowances, never the sole cost control. Prices and numeric paid allowances follow usage measurements.

## Current implementation

- `apps/api/internal/identity/identity.go`: verified-account JWT verification and principal; preserve strict verification and malformed-credential rejection.
- `apps/api/internal/adapters/postgres/identity.go`: immutable issuer/subject binding to product user; live server-owned role/disabled checks. `users.role` already supports `admin`.
- `apps/api/internal/httpapi/admin_questions.go`: guarded question-draft and publish routes. Extend this implementation rather than duplicating authoring (#37).
- `apps/api/internal/adapters/postgres/matches.go`: transactional invitations, seat admission, reservations and outbox. Invitation tokens are random and stored hashed; seat search currently supports eight seats.
- `apps/api/internal/adapters/postgres/submissions.go`: owner quota, one nonterminal job per owner, idempotency and global queue admission in PostgreSQL. Current defaults: 10 jobs/minute, burst two, 100/24h; global unfinished-job cap 200.
- `apps/web/src/features/matches/InvitePage.tsx`: invitation landing screen currently offers sign-in only, without preserving the invitation destination.
- `apps/web/src/features/editor/WorkspacePage.tsx`: anonymous browser editing exists; Run/Submit guard currently prompts inline. Replace with an accessible modal immediately.
- `docs/plans/operating-defaults.md`: release workload target 40 coding sessions; local runner starts with two slots. Neither establishes classroom capacity.

## Required entry flows

| Context | Anonymous dialog | Actions |
| --- | --- | --- |
| Guest-enabled invitation | **Join this lobby** — “Sign in or continue as a guest to join this lobby.” | Sign in; Continue as guest; dismiss |
| Regular invitation | **Sign in to join** — “This lobby requires an account. Sign in to join.” | Sign in; dismiss |
| Practice Run or Submit | **Sign in to run tests** — “Sign in to run tests and submit solutions. You can keep editing without an account.” | Sign in; Keep editing |

Lobby dialog opens after invitation metadata resolves, before admission. Signed-in users use the existing explicit join action without the anonymous prompt. Guest continuation asks for a display name, then atomically creates/reuses the room participant and joins. Display names are escaped, length-bounded and identified as unverified; duplicate names never establish identity.

- Loading: show a neutral invitation loading state, never guess access type or flash the wrong dialog.
- Invalid, expired, revoked, full or closed invitation: show a safe unavailable state with recovery; no guest or sign-in action pretending admission is possible.
- Metadata/network errors: offer retry; failure never enables guest access.
- Authentication uses a validated same-origin `returnTo` containing the complete invitation path. After sign-in, return to the invite and revalidate before explicit joining; never duplicate admission on reload.
- An existing guest session for this room resumes its seat. A guest credential from another room cannot join a regular room.
- Dismissing leaves a useful invitation landing page with a Join action that reopens the dialog.
- Guest join races use pending/disabled actions and idempotency. A settings change between metadata and join is enforced server-side, returning refreshed choices.
- Radix dialog: focus trap, title/description, Escape/backdrop dismissal, focus restoration, keyboard operation, reduced motion and narrow viewport support. Reuse DESIGN.md tokens and existing dialog styles.
- Practice prompts on button and keyboard shortcut before any execution request. Dismissal preserves code, custom cases, selected pane and scroll. Preserve full path/query/hash on sign-in. Existing guest/account draft namespaces remain separate; do not silently migrate code between identities. Offer explicit import later if needed.

## Authorization and entitlement model

Use a small policy module, not an external policy service. Roles expand to named permissions; entitlements control product access; quotas bound consumption.

| Layer | Initial values | Authority |
| --- | --- | --- |
| Principal | account or guest; immutable user/session ID | Verified server session |
| Role | existing user/admin | Product database |
| Permissions | `questions.write`, `questions.publish`; future sensitive operations explicit | Server role mapping |
| Entitlements | `matches.host_guests`, hosted intelligence, experimental features | Active server grants |
| Limits | seats, active rooms, duration, execution/concurrency budgets | Plan defaults plus explicit overrides |

Suggested records:

- `entitlement_grants`: user, bundle/feature, source (`subscription`, `manual`, `internal`), external reference, validity, revocation, reason and actor. Unique source references make billing retries idempotent.
- `quota_overrides`: user/resource, bounded value, validity, actor and reason. Reject values exceeding operator-configured platform ceilings.
- `access_audit`: append-only grant/revoke/publish/elevation records with immutable IDs, actor, target, scope, reason, timestamp and request/operation ID; never credentials or submitted source.
- Existing `users.role` remains the initial role authority; avoid a generalized role graph for one administrator.

`internal` grants all currently registered premium capabilities and explicitly enabled experimental features. New premium feature registration must define internal-bundle behavior in the same change. Elevated quotas are explicit. Billing cancellation only revokes subscription-derived grants, never an independent internal/manual grant.

Return effective capabilities/limits from an authenticated endpoint for UI rendering; every mutation and execution admission independently checks authoritative policy. Never accept browser roles, plan names or requested sponsor IDs. Fail closed when access cannot be established. Refresh policy on privileged requests and bounded renewal of long-lived sessions; revoke active guest access through room membership checks.

## Admin bootstrap and recovery

1. Operator registers normally and enables passkey or MFA. Verify the chosen method actually supplies strong/recent authentication evidence; email verification alone does not.
2. Private CLI resolves an exact existing product user ID and displays its immutable identity binding. No first-user rule, email allowlist, automatic account linking or public bootstrap endpoint.
3. CLI `access grant/revoke/inspect` supports dry-run, target environment, exact scope and reason. A grant updates role/entitlements and appends an audit event atomically; repeat operation IDs are safe.
4. Execution requires separately provisioned operator credentials; web runtime cannot invoke the CLI. Isolate role/grant writes from ordinary profile APIs and, where practical, runtime database permissions. Seed scripts remain loopback-only.
5. Question authoring uses the admin permission; publishing and role/grant management require recent strong authentication (initial proposed elevation window: 10 minutes). Short-lived server elevation records are bound to the current session and never inferred from a client timestamp. If step-up is unsupported, privileged elevation stays unavailable.
6. Revocation takes effect on the next protected request, invalidates elevations and closes affected subscriptions. Preserve ordinary account data.
7. Recovery uses documented operator access to revoke sessions and regrant exact permissions; no permanently privileged alternate login. Retain tested backup authenticators/recovery methods.

Admin/internal grants confer no automatic access to private participant source, sandbox escapes or unlimited runner usage. Interview source visibility is a separate, explicit room role and product disclosure.

## Guest identity and invitations

Preserve current owner foreign keys pragmatically: allow an explicitly marked ephemeral guest in the product `users` table, without a Better Auth account, email or provider binding. Add principal kind/lifecycle metadata and session/membership records. Existing users backfill as accounts. Account-required endpoints must check kind explicitly; do not interpret presence of a user ID as a full account.

- `guest_sessions`: hashed random token, ephemeral owner ID, room scope, issued/idle/absolute expiry and revocation. Initial absolute expiry: room end plus two hours, bounded at 24 hours; idle expiry must permit normal coding and active work.
- `matches`: `access_mode` (`accounts_only` default or `guests_allowed`), sponsoring account, explicit limits and policy version. Access-mode mutations check host identity and entitlement.
- `match_participants`: membership/role; distinguish invited link, admitted seat and session. Keep reservation and outcome invariants intact.
- Public invite resolution returns only valid access mode and availability plus a bounded safe lobby label if needed. No problem, roster, source, hidden tests, sponsor identity or bearer session. Rate-limit resolution; redact invitation secrets from logs/analytics and use restrictive referrer policy.
- Validate invitation and entitlement before minting identities. Atomic admission locks prevent guest/seat floods; cap outstanding guest identities per room, even after kicks/leaves. Rejoining uses the original seat whenever valid.
- Use a distinct server-issued guest credential namespace, not weakened account JWT verification. Same-origin Secure/HttpOnly/SameSite cookies, request-origin/CSRF protections, hashed storage and short-lived server-authorized realtime credentials. Never place session secrets in URLs or localStorage. Invalid supplied account credentials still reject; absent credentials may deliberately select the guest flow.
- Scope all reads/mutations/submissions/realtime authorization to guest membership and room state. Explicitly deny guest practice execution, authoring, profile operations, hosting and cross-room access. Guest subscription revocation follows the same checks as REST.
- Rotating an invitation blocks future joins; it does not evict existing participants. Kick/revoke is separate. Prevent guest reentry with individual admission tokens/host approval when stronger control is needed; an open shared link cannot prove a returning person is the same human after cookie deletion.
- Host may lock admission. Disabling guest mode with existing guests is rejected until they leave or are explicitly removed. Subscription expiry prevents new guest rooms/admissions; already-started rooms retain their bounded budget until completion. Emergency/security revocation can stop admissions immediately.
- Optional guest-to-account conversion requires proof of both sessions, explicit consent and session rotation. Preserve quota attribution; never merge identities by display name/email.

## Atomic resource accounting

Enforce participant, room, sponsoring host and platform limits. Ordinary signed-in rooms retain normal accounting; mixed guest rooms charge guest execution to the sponsor, while signed-in participants keep their ordinary quotas. All execution still counts against room/platform pressure limits.

- Participant: current one nonterminal job; token bucket and total room allowance. Bound source, cases, output, sockets, reconnects and metadata requests.
- Room: seats, join attempts/issued identities, lifetime, accepted jobs, reserved execution time and queued/running concurrency.
- Sponsor: aggregate guest workload across rooms, active guest rooms, monthly included execution allowance and optional started-room allowance. Define billing windows explicitly in UTC from grant/subscription boundaries.
- Platform: bounded runners/queue, memory/time/process isolation, storage and admission kill switch. Internal users obey these ceilings.
- Shared-campus IPs: generous network abuse thresholds; principal/room/sponsor limits are primary. Never equate one IP with one participant. Trust proxy IP headers only from configured proxies.

Add reservation/usage records tied to immutable submission and attempt IDs, room and sponsor. In the existing admission transaction, check idempotency, validate policy, lock budget rows in a documented consistent order, reserve worst-case execution cost and commit job plus reservation. Failure rolls everything back. No separate check-then-increment window across API replicas. Define lock order against current owner/match/global-queue locks and test deadlock retries.

Workers settle actual charged sandbox duration and release unused reservation with fenced, idempotent completion. Crash/lease expiry/cancellation recovery settles once. Retries consume bounded internal capacity; infrastructure faults do not repeatedly charge customers. Reserve capacity for a bounded retry policy or fund retries from a separate platform allowance. Record all attempts for true cost telemetry. Reject before admission when reservations cannot fit; never overdraw because execution later proved expensive.

Expose stable errors (`entitlement_required`, `room_full`, `quota_exceeded`, `queue_saturated`, `guest_session_expired`) with safe messages and Retry-After/reset metadata where meaningful. Show remaining allowances/warnings before start. Never silently auto-upgrade, overage-bill or cancel a competition for ordinary subscription changes.

Use fair scheduling across sponsors, then rooms/participants, with bounded per-host active jobs. Preserve match deadlines, submission ordering and finalization semantics; schedule fairness must not rewrite scoring. If capacity is insufficient, do not start an event promising unsupported service.

## Delivery sequence and acceptance gates

| Phase | Deliverable / code boundary | Dependencies / completion evidence |
| --- | --- | --- |
| 0 | Practice modal in WorkspacePage | Live guest Run/Submit, shortcuts, dismiss/focus, draft preservation; account execution unchanged |
| 1 | Identity policy, entitlement schema/resolver and authenticated capabilities contract | Migration/backfill, fail-closed policy tests, free regular hosting regression; align #69 |
| 2 | Audited private access CLI, internal bundle and privileged step-up | Phase 1; exact-user grant/revoke, audit/idempotency, unsupported step-up denial, session revocation; reuse #37 authoring |
| 3 | Sponsor/room reservations and metering in judging/worker adapters | Phase 1; disposable-DB concurrency, crash/retry/cancel settlement and no double charge; telemetry |
| 4 | Guest principals, invite metadata, atomic join and realtime scope | Phases 1 and 3; forged/expired/cross-room credentials, invite rotation, seat races, revocation and cookie/CSRF tests |
| 5 | Lobby popup and host access toggle in matches UI | Phase 4; all entry states above, sign-in return, keyboard/mobile/themes, signed-in regression; toggle denied server-side without entitlement |
| 6 | Bounded small-room pilot using manual internal grants | Phases 2-5; real runner isolation/cost measurements and fairness under saturation; feature flags default off outside pilot |
| 7 | Classroom/event capacity and fair scheduler | Pilot evidence; remove hardcoded eight-seat assumptions across SQL/contracts/UI/realtime only after load/cost gates |
| 8 | Subscription adapter and customer allowances | Metering/pilot; verified signed webhook, replay/out-of-order handling, source-specific revoke, expiry/downgrade tests; Terraform/GitHub Actions deployment |
| 9 | Interview workspace | Guest foundation; observer/interviewer permissions and disclosed source visibility first; collaborative editing/presence/conflict handling separately |

One issue per implementation phase when scheduling work, linked to #83; dependency order above is the work ledger. Solo implementation stays on `dev`. No concurrent agents/worktrees required. Large planning scope does not authorize building these phases now.

## Validation and operations

- Unit/contract: principal kinds, permission/entitlement resolution, internal bundle coverage, return URL validation and response redaction.
- PostgreSQL integration: atomic role/grant audit, duplicate admission, concurrent guests, cross-instance budgets, lock-order recovery, usage windows, retries and revocation. Use only a separate disposable `QUOREM_TEST_DATABASE_URL`.
- Browser: anonymous regular/guest invitations; guest name validation; refresh/reconnect; existing account; metadata errors; settings race; expired/full room; open dialog plus shortcuts; narrow viewport/light/dark/reduced motion. Never log out the user's live browser for testing.
- Security: direct endpoint calls with forged browser roles/sponsor IDs, invalid account bearer plus guest cookie, disabled host, revoked guest and unsupported elevation. Hidden cases/opponent code stay absent from responses/events.
- Load: declare seat count, languages, Run/Submit mix, burst and duration. Measure admission rejection, queue/result p95, DB locks/connections, memory, socket fanout, runner utilization and cost; distinguish targets from measured capacity. First pilot stays within current small-room bounds. Larger TA events require measured reserved capacity.
- Monitor per-room/sponsor accepted/rejected work, reserved/actual execution, attempt retries, oldest queued job, session issuance/revocations and budget exhaustion. No source or invitation/session secrets in telemetry.
- Pilot retention defaults: guest credentials expire as above; guest source/results scrub after seven days, including operational cleanup/backups under documented policy; remove orphan guest identities after dependent data is removed. Retain minimal quota/audit facts for 90 days without source, names or session tokens. Review retention before assessed classroom use.
- Rollout switches independently control guest-room creation, new guest admission and execution. Emergency disable preserves local drafts and existing results. Rollback stops new admissions first, drains fenced jobs/reservations, revokes guest sessions as needed and retains accounting/audit rows; do not drop schema under active jobs.

## Deferred product decisions

Exact prices, included execution budgets, classroom maximum seats and supported event guarantees require measurements. Anonymous guest display names do not verify student identity; assessed work needs an explicit roster/identity mechanism. Premium/internal entitlement changes do not deploy hosted intelligence (#69) or provision infrastructure automatically. Collaborative interviews, billing UI and account conversion are follow-on scope.

## Phase 0 verification (2026-10-22)

- `vp check`: formatting, lint and type checks pass.
- `vp test apps/web/src/features/editor/guestWorkspace.test.ts apps/web/src/features/auth/session.test.ts apps/web/src/features/auth/signInReferral.test.ts`: 14 tests pass.
- Live Vite/HMR: `http://127.0.0.1:5180/practice/mirror-letters`; listener cwd `/Users/engai/CS/Projects/quorem/apps/web`. Separate guest-origin tab preserved the signed-in localhost session.
- Run/Submit buttons and Meta+Enter / Meta+Shift+Enter open the accessible modal. Keep editing and Escape dismiss, restore the originating control, and preserve the existing draft. Sign-in link retains the workspace destination. Broader guest-lobby/backend acceptance gates remain future work.
