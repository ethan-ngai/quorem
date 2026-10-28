# PostgreSQL hot queries

Work ledger: [#194](https://github.com/ethan-ngai/quorem/issues/194).

## Changes

- Bind UUID lookup parameters as UUIDs; do not cast indexed interview, submission or workspace IDs to text. Invalid/noncanonical-length IDs still return `not_found`; standard uppercase UUIDs resolve normally. `uuidLookup` provides the shared conversion for callers, including queue fencing.
- Add `entitlement_grants_unrevoked(user_id, feature) WHERE revoked_at IS NULL`: socket commands need current grants, not revoked history.
- Add `interview_execution_question(session_id, question_epoch, submission_id)`: current-question result lookup skips earlier question histories before joining submissions/jobs.
- Qualify `ORDER BY interview_outbox.sequence`: the selected `sequence::text` otherwise shadows the numeric column, producing lexical order and an unnecessary sort. The regression covers sequence 2, 10 and 100.

These indexes are included in the product schema baseline. Index creation in transactional migrations can lock populated tables; measure migration duration against hosted data before claiming interruption-free rollout.

## Local evidence

Measured 2026-10-25 with PostgreSQL in the local `quorem-postgres-1` Docker container, using separate disposable database `quorem_indexes_194`. `TestHotQueryPlans` builds 5,000 synthetic users and rooms, 300,000 grant rows (59 revoked and one unrevoked per synthetic user), 110,000 submissions/jobs/interview executions, 100,000 versioned document updates, and 5,000 presence rows. The target room has 10,000 execution records across questions; only its last eight belong to its current question. Jobs have 109,900 completed and 100 pending rows. Only 64 outbox rows remain unpublished.

The test runs `ANALYZE`, then captures `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Before plans temporarily hide the two new indexes in a rolled-back transaction and use the old SQL. After plans use the new SQL/indexes. No planner indexes/scan modes are forced. The document lookup uses the production query constant; latest-result and outbox queries likewise share their production constants. Other probes reproduce the listed hot predicate/join/order shapes. Synthetic rows are removed afterward.

Single-run execution times and total shared buffer hits plus reads from the top plan node:

| Query                               | Before ms / buffers | After ms / buffers | Observed plan change                                                                                               |
| ----------------------------------- | ------------------: | -----------------: | ------------------------------------------------------------------------------------------------------------------ |
| Document authorization/version read |          0.459 / 75 |         0.048 / 15 | Typed room key and unrevoked-grant index; the old plan could already reach the room PK through its membership join |
| Owner-scoped submission lookup      |          0.113 / 25 |          0.007 / 4 | Owner-history bitmap scan/filter becomes submission PK lookup                                                      |
| Latest current-question result      |         1.034 / 298 |         0.052 / 71 | Session-history bitmap/hash filtering becomes question-epoch index lookup                                          |
| Host entitlement existence          |          0.035 / 63 |          0.008 / 3 | All-history grant bitmap becomes unrevoked-grant index lookup                                                      |
| Pending interview outbox batch      |        5.074 / 2203 |        0.173 / 395 | Lexical sequence sort removed; numeric ordered index produces the limited batch directly                           |

These are local plan observations, not median benchmarks, production latency estimates, or capacity claims. Later probes benefit from pages warmed by earlier probes. Recently updated outbox index entries have not been vacuumed, affecting buffer counts. Buffer reductions, index conditions and removed sorts support the changes independently of millisecond ratios; repeat on the hosted data distribution for production evidence.

## Existing indexes retained

Observed after plans, without adding duplicate indexes:

| Path                                | Index / evidence                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Identity binding plus user lookup   | `identity_bindings_pkey(issuer,subject)` and `users_pkey`; 0.033 ms / 6 buffers          |
| Incremental document pull           | `interview_updates_pkey(session_id,epoch,version)`; 0.025 ms / 23 buffers for 20 updates |
| Presence by room                    | `interview_presence_pkey(session_id,user_id,client_id)`; 0.009 ms / 3 buffers            |
| Membership authorization            | Existing room/user PK and `interview_members_user` partial index                         |
| Owner execution exclusion           | `owner_busy` partial unique index; 0.020 ms / 2 buffers                                  |
| Global pending-job count            | `jobs_claim` partial index-only scan; 0.021 ms / 4 buffers for 100 pending jobs          |
| Ready-job selection shape           | `jobs_claim` ordered scan plus incremental tie sort; 0.028 ms / 4 buffers                |
| Match and interview pending notices | Existing partial sequence indexes; interview SQL fixed rather than another index added   |
| Interview guest credential          | Existing token-hash PK and unique owner key                                              |

The separate Better Auth schema has session token uniqueness, `auth_session_user`, identity provider/account uniqueness, user/email keys, assurance-session PKs, and indexes for account ownership and expiry cleanup. The table above measures the product identity binding, not Better Auth request latency.

The claim probe isolates job eligibility/order/locking; it is not the complete claim transaction with authorization/fixture joins or global admission serialization. Indexes do not remove required transactional serialization. Queue mutation/fencing and wakeup changes are owned by the separate worker change.

## Reproduce

Use a separate disposable database: integration tests truncate fixtures. Never use the active development database.

```sh
docker exec quorem-postgres-1 createdb -U quorem quorem_indexes_194
QUOREM_TEST_DATABASE_URL='postgres://quorem:quorem@localhost:54329/quorem_indexes_194?sslmode=disable' \
QUOREM_TEST_QUERY_PLANS=1 \
go test ./apps/api/internal/adapters/postgres -run '^TestHotQueryPlans$' -count=1 -v
```

The local fixture credentials above are public development defaults. Save the emitted JSON plans when comparing environments. Ordinary PostgreSQL regressions also cover malformed lookup IDs, uppercase UUIDs and numeric outbox ordering.
