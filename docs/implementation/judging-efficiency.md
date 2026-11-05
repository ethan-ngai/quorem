# Judging efficiency audit

2026-11-05. Tracks #285. Native runtimes, fresh case containers, independent verification and authoritative PostgreSQL fencing remain required. No prewarming.

## Implemented

- Database transaction setup sends `BEGIN` and both transaction-local timeouts in one query. Every explicit transaction saves one client/server exchange. Validated numeric snapshots prevent SQL interpolation of unvalidated values. The setup SELECT preserves repeatable-read snapshot timing. Commit, rollback and cancellation ownership are unchanged.
- Verifier bundles load admitted input pages inside the transaction already fencing the frozen challenge. The shared input reader owns the query. This removes a connection and a transaction per bundled case. Including combined setup, the bundle path drops from ten to six SQL query messages.
- Inputs up to 65,536 bytes retain an immutable verified memory snapshot. Repeated streams copy their ranges. Larger inputs still spool to disk. Digest, channel, expected identity and disposal checks apply to both paths. No cross-attempt cache.

## Local measurements

Baseline `c0968089`, Apple development host, 100 measured alternating iterations after ten warmups. Each spool iteration verifies the input, reads it three times and disposes it.

| Input   | Disk baseline median | Optimized median |
| ------- | -------------------: | ---------------: |
| 4 KiB   |             0.407 ms |         0.028 ms |
| 64 KiB  |             0.549 ms |         0.064 ms |
| 128 KiB |             0.570 ms |         0.563 ms |

A one-query transaction through the Worker connection owner used four SQL query messages before, three after. Twenty iterations with an intentionally injected 10 ms delay per query measured 53.3 ms before and 43.2 ms after. This demonstrates removal of one exchange; it is not a production latency estimate. Connection establishment was included.

Validation passed native PostgreSQL transaction/failure tests, workerd transaction cleanup/deadlines, PostgreSQL claim/result/accounting tests, bundled verification and closed-stream rejection, all five Docker language harnesses, large streamed requests, and persisted checkpoint/resume provenance. Hosted Hyperdrive and production end-to-end validation remain outstanding for this change.

## Remaining opportunities, ordered by impact

| Priority | Concrete finding                                                                                                                                                                     | Owner                                                                                                                                        | Next action                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Production drain hardcodes one execution slot; overlapping jobs serialize. The service Durable Object also allows one active drain.                                                  | `apps/api/src/runtime/composition/judging-drain.ts`, `deploy/hono/services/worker.js`                                                        | Add bounded configurable slots with account/container/DB admission limits, then benchmark concurrent clients. Increasing the queue consumer alone cannot bypass this limit. |
| 2        | Every suite case waits for sandbox startup, destruction, checkpoint persistence, staging and signed verification before the next case.                                               | `apps/runner/src/engine/execute.ts`, `deploy/case-sandbox.js`                                                                                | Measure 1/5/20-case suites across languages. Evaluate a bounded pipeline preserving fresh containers, ordered checkpoints, cancellation and signed results.                 |
| 3        | Every manifest read recomputes the full rolling suite digest. Verification preparation and checkpoint saves reread manifests per case, giving suite-wide work repeated per case.     | `apps/api/src/adapters/postgres/judging/inputs/read.ts`, `apps/api/migrations/058_suite_manifests.sql`                                       | Profile large suites, then persist the digest when immutable inputs seal. Requires a schema migration and immutability enforcement.                                         |
| 4        | Result fields/chunks each open their own staging transaction; checkpoint and verification preparation also fetch manifest/reference separately.                                      | `apps/runner/src/engine/execute.ts`, `apps/api/src/adapters/postgres/judging/worker/staging.ts`, `verification-prepare.ts`, `checkpoints.ts` | Introduce a bounded atomic frame/chunk command at the shared execution port, preserving streaming limits and idempotency.                                                   |
| 5        | Case startup and stop issue serial storage operations for related keys.                                                                                                              | `deploy/case-sandbox.js`                                                                                                                     | Batch supported storage reads/writes/deletes, retaining durable startup/deadline/cancellation ordering; validate crash and cancellation interleavings.                      |
| 6        | Admission and claiming share a global advisory lock. Admission also counts unfinished jobs; concurrent load can serialize here.                                                      | `apps/api/src/adapters/postgres/judging/admission/core.ts`, `worker/claim.ts`                                                                | Measure lock waiting before changing capacity accounting. Keep admission limits atomic.                                                                                     |
| 7        | Production benchmark polls every 250 ms and covers five sequential, one-case Python jobs. It cannot establish browser render latency, concurrency capacity or other runtime latency. | `scripts/hono-production-benchmark.mjs`, `apps/web/src/features/editor/submissionStream.ts`                                                  | Add SSE-observed completion, case-count/language and concurrent-client benchmarks, recording admission/claim/start/exit/destroy/verify/commit/display boundaries.           |

Already checked: production API regional placement remains configured; direct wake and durable queue fallback coexist; running/final notices are deferred with `waitUntil`; verifier callbacks bundle small fields; final-case verification overlaps attempt teardown. The shared application-container readiness loop is not on the direct case execution path.

No universal under-five-second claim follows from this audit. Arbitrarily long contestant execution, large suites, queue load and provider variability require explicit workload and capacity bounds.
