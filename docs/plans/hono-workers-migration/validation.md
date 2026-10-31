# Validation and acceptance

[Plan index](README.md)

### Coverage inventory

Create a checked-in migration matrix during wave 0: endpoint/command, old owner, new owner, request schema, auth policy, transaction, event intent, error behavior, test, activation/removal status. Include all registered route loops, auth routes, internal drains, case control, WS commands, schedulers, retention, seeds/imports and profiling utilities. Count-based checks alone cannot establish parity.

Retain Go tests until their corresponding behavior is represented and passing in TS. Use Go as an oracle where behavior is intentional; conflicting/obsolete behavior needs a recorded decision, not automatic preservation.

| Layer | Required evidence |
| --- | --- |
| Pure rules/codecs | Golden and property cases for match transitions, question semantics, numeric/SQL comparisons, starter generation, lossless payloads, source and operation hashes, UTF-16 changes |
| HTTP | Hono `app.request` tests against fake ports; actual contract/status/header/cookie checks; invalid content types/JSON, body caps, unknown fields and credential precedence |
| PostgreSQL | Real transactions, lock contention, duplicate/reordered commands, unknown commits, stale attempts, rollback, serialization, schema fresh/upgrade/idempotent rerun and immutable references |
| workerd | Native auth, SQL transaction lifetime, bindings, queues, DO wake/hibernate, alarms, streaming caps, module imports and all supported compatibility flags |
| Realtime | Two clients/two instances, concurrent edits/rebase, lost acknowledgments, missed/coalesced notices, token rotation, revocation, guest removal, connection/window caps and repair |
| Judge | Python/Java/TS/OCaml/SQL runs/submits/custom cases; compile artifacts, hidden visibility, max suites, cancellation/timeout, network/filesystem isolation, teardown and checkpoint replay |
| Browser | Existing editor flows, practice/Odyssey, SQL and private-question matches, interview host/candidate/guest, offline reconnect, results/stage transitions and authoring |
| Portability | Same app/protocol/domain suites on Node + local PostgreSQL/Docker/Mailpit/Garage; no Cloudflare credentials or SDK imports required |
| Hosted | Worker CPU/memory/bundle/connection limits, realistic latencies/cost, actual sandbox/runtime equivalence and role drain; separate from local correctness |

Use current Cloudflare Vitest integration inside workerd, not only Node-based mocks. Verify its compatibility with repository `vp`/Vitest versions in the spike. Cloudflare currently documents `@cloudflare/vitest-plugin`; do not blindly install the older pool package from stale Hono examples. [Runtime testing](https://developers.cloudflare.com/workers/testing/vitest-integration/), [Hono request testing](https://hono.dev/docs/guides/testing).

### Required failure scenarios

- Crash after transaction commit before wake; wake before admission commit; new intent during final drain; locked outbox row; publish succeeded but acknowledgment failed; exhausted queue/alarm retries; database unavailable during alarm.
- Duplicate joins/starts/submits/cancels, concurrent guest budget spend, stale source/epoch, unknown commit, result arriving after match outcome, private question revoked during play.
- Supervisor dies after claim, lease expires while case still runs, teardown cannot be confirmed, stale completion/checkpoint writer, mixed old/new judges and feature capability filtering.
- Socket hibernates during role change; source notice coalesces with membership notice; auth revoked between snapshot scheduling and read; slow SQL command cannot suppress heartbeat; pending editor updates survive reconnection.
- Fresh/retained opaque payloads, NUL strings, large compressed checkpoints, numeric precision beyond JS safe integers, malformed surrogate sequences and truncated binary frames.

Tests use explicitly separate disposable `QUOREM_TEST_DATABASE_URL` and `AUTH_TEST_DATABASE_URL`. Never run truncating tests against development or production databases. Parallel agents receive distinct databases/schemas and ports; auth tests follow their current serial isolation requirement.

Proposed package commands, established by wave 1: `vp -C apps/api test`, `vp -C apps/api run test:workers`, `vp -C apps/api run test:integration`, `vp -C apps/runner test`, `vp -C apps/auth test`, `vp -C apps/language test`, plus `vp check --no-fmt` and `vp run contracts:check`. Preserve meaningful existing Python/Terraform suites. Document actual commands after wiring rather than reporting proposed commands as passing.

Browser verification uses live Vite/HMR: `vp -C apps/web dev` / integrated `make dev`. Verify server process checkout and report exact URL. No frontend rebuild/preview iteration. This migration does not authorize editor redesign; any necessary UI adjustment follows root `DESIGN.md` and design-system skill.

Additional migration gates: Drizzle schema parity without destructive diffs; transaction rollback and lock equivalence; exact bigint/bytea codecs; explicit public/private projections; query count and connection lifetime evidence for hot snapshots; no duplicate policy/codecs; no cache/vector infrastructure or background indexing introduced.
