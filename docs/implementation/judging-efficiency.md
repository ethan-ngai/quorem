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

## Concurrent judging implementation

Eight submission slots and up to twenty fresh native case lanes per attempt replace the single-slot bottleneck. Checkpoints persist in ordinal order while bounded verification overlaps later native work. Two-second case-boundary slices yield when other submissions wait. Large source/metadata/input/artifact windows reduce fanout using an eight-MiB per-job input budget.

Suite digests now seal into an immutable database table. Checkpoint and verification preparation bind their inputs inside their existing fenced transaction. Completion fields use batches of at most sixteen 64-KiB chunks. Root sandbox cleanup covers every fixed lane after eviction and refuses confirmation if any child fails. Remote scope includes the lane protocol revision to prevent unsafe reclamation by older runners.

Eight-user/twenty-case controlled fixtures measured 2.41–2.63s per user with 500ms simulated sandbox time and real PostgreSQL/verification/SSE. Real Docker on the development host measured 14.5–15.7s with the initial four-lane-per-user configuration. Neither result proves Cloudflare latency. Production acceptance uses temporary non-admin actors and fails unless every measured user is below five seconds in both rounds.

Remaining measurements:

- Production cold/tail latency for eight simultaneous twenty-case Python runs.
- Compiled-runtime latency, large input/output payloads and sustained overload.
- Global admission/claim lock waiting under load. The lock remains necessary for atomic capacity accounting until a measured replacement is validated.
- Browser paint timing beyond the SSE-triggered authorized result snapshot.

See [concurrency plan](../plans/judging-concurrency.md) for rollout fencing and acceptance criteria.

Already checked: production API regional placement remains configured; direct wake and durable queue fallback coexist; running/final notices are deferred with `waitUntil`; verifier callbacks bundle small fields; final-case verification overlaps attempt teardown. The shared application-container readiness loop is not on the direct case execution path.

No universal under-five-second claim follows from this audit. Arbitrarily long contestant execution, large suites, queue load and provider variability require explicit workload and capacity bounds.

Production rollout exposed a cleanup regression: repeatedly constructing child Requests from an incoming streamed DELETE transfers its body, so subsequent lane requests fail and aggregate teardown remains unconfirmed. A streamed-DELETE regression reproduces HTTP 503. Lane control requests now construct fresh bodyless GET/DELETE commands, while POST forwarding retains its single body transfer. Hosted recovery confirmed: generation 8 returned a clean queue after this fix.

Hosted concurrency evidence: sixteen 20-case submissions completed on their first attempt in 30.9–35.8s (persisted admission-to-completion); claim delays were 0.15–0.76s. Client observation encountered HTTP 503, so acceptance failed. Native startup waited before response headers, consuming the shared drain invocation's six pending-header connections. Empty admission frames now precede startup; native destruction still precedes the terminal frame. Durable used-lane inventory prevents cleanup from creating seven unused sibling objects for a one-case run. These changes use execution scope v2 and require an idle rollout. Hosted timing remains pending.

Bounded case windows now fetch refs and small pages in one fenced read. Atomic finalization omits last-window resume checkpoints; earlier windows remain durable. Twenty hosted lanes fit the twenty-case acceptance suite into one native wave. Scope v3 requires an idle rollout. Controlled 500ms-native evidence is 2.25–2.27s for all eight users; hosted acceptance remains pending.
