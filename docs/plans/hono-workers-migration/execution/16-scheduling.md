# 16 Deadline scheduling and retention

Issue #374. Match deadline discovery uses PostgreSQL time and existing match/pending rows; the injected match command owns locking, generation checks and transitions. There is no interview transition implementation here. The coordinator is a composition primitive: runtime owners must bind a Durable Object class to `ShardAlarm`, inject real commands, configure a stable shard count, and invoke `scheduledRepair` independently. Nothing is mounted or deployed here.

`activateDeadline` first inserts an operation receipt and awaits coordinator prearm. Its callback must call `consumePrearm(tx, id, shard)` inside the same transaction as deadline activation. The receipt UPDATE holds its row lock until commit; expiry cleanup must acquire that lock, and lock timeout is an error, not an abandonment. Thus a stalled or ambiguous commit cannot be mistaken for an expired unused admission. A committed receipt is acknowledged only after the coordinator reads deadlines and persists any next alarm. Unused prearms expire; stale or duplicate wakes reread PostgreSQL. A scheduled repair wakes every shard even if one wake fails and runs one bounded retention batch; retry-exhausted alarms therefore need this independent trigger. Node timers are acceleration and require the same external recovery arrangement after process loss.

Retention executes at most 256 rows per category per invocation, preserves unpublished outbox rows and live jobs, and applies the existing 7/30-day policies. No maintenance HTTP endpoint is exposed. The SQL shard filter currently scans eligible matches and is not a validated high-volume indexing strategy. Do not activate until workload/query plans and the configured shard count are reviewed.

Local verification, disposable PostgreSQL 17 on 127.0.0.1:55453, database `quorem_hono_scheduling_test`, migrations 007–050 applied in order:

```sh
QUOREM_SCHEDULING_TEST_DATABASE_URL=<disposable-url> vp -C apps/api exec vitest run --config src/adapters/postgres/events/scheduling/vitest.config.ts
QUOREM_SCHEDULING_TEST_DATABASE_URL=<disposable-url> vp -C apps/api exec vitest run --config src/adapters/postgres/events/scheduling/vitest.workers.config.ts
vp -C apps/api run typecheck
vp -C apps/api run check:boundaries
```

Node: 6 tests passed; DB-clock behavior with stale host clock, pending generation, receipt expiry and lock-held delayed commit, single-consumption fencing, bounded retention, independent repair and final-drain wake. Native workerd: 3 tests passed against PostgreSQL, using real Durable Object alarms for pending and committed receipts a future deadline, and failed-alarm rearming. No real match command exists yet, so the workerd fixture fails if a due transition is requested. A local Node `setTimeout(60000)` invoked `scheduledRepair` after 60,000 ms and woke one shard; this measures a single local timer, not hosted Cron or worst-case deadline delay. Hosted timing and the product delay gate remain unverified. The root `vp check --no-fmt` has two pre-existing type errors in `apps/api/src/adapters/delivery/delivery.test.ts` on this base; no scheduling findings.
