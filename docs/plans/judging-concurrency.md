# Concurrent judging

Tracks #285. Acceptance workload: eight distinct users, twenty fast cases per submission, under five seconds from submission request to observed terminal result. Cold and repeated runs measured separately. No prewarming or weakened isolation. Compiler and contestant durations reported explicitly; the acceptance workload does not establish an unconditional latency guarantee.

Implementation order:
1. Persist and enforce immutable suite digests at input sealing, avoiding per-case suite scans.
2. Batch bounded completion chunks through the shared repository and private transport.
3. Add eight fixed case lanes per attempt. Root sandbox owns durable cancellation and confirms teardown of every lane, including after eviction. Each invocation still starts and destroys a fresh container.
4. Execute bounded windows of cases, compile once before fanout, persist checkpoints in ordinal order, and verify bounded frames concurrently. Settle all work before yielding or teardown; failures cannot publish partial final results.
5. Configure eight submission slots and eight case lanes, enforce bounds centrally, and shorten case-boundary scheduling slices for fairness. Keep durable admission, per-user quotas and queue capacity.
6. Batch sandbox storage operations while retaining cancellation/startup/deadline ordering.
7. Extend benchmarks to eight authenticated users, 1/5/20 cases, SSE-triggered snapshots, repetitions and explicit under-five-second checks. Add local concurrency, checkpoint/cancellation, crash/teardown and all-language validation.

Validation gates: disposable PostgreSQL migrations/immutability; native and workerd commands; fresh sandbox lane recovery; all runtime harnesses; overlapping submissions and large suites; full CI. Hosted acceptance is a separate required measurement, never inferred from fixtures. Deployment through Actions and provisioning through Terraform.

Remote sandbox scope includes the case-lane protocol revision. Promotion requires draining old-scope attempts before changing peers; rollback must also drain/recover the active scope. An old runner cannot reclaim a new-scope attempt. Root teardown always covers all fixed child lanes. Durable release controls retain their original genesis scope, independently of the execution scope.

Initial 32-lane evidence: eight users and twenty cases each completed via real admission, PostgreSQL checkpoints, independent verification and SSE in 3.56–3.60s with a controlled 500ms sandbox fixture (32 native lanes). Real Docker on the development host took 14.5–15.7s for the same workload; this is a measured miss, not a hosted result. All five runtime harnesses remain validated independently.

Production acceptance provisions eight short-lived, non-admin synthetic auth accounts, uses ordinary session/token/workspace/submission/SSE APIs, then revokes sessions and removes auth accounts. Disabled product identities retain ownership of historical benchmark submissions. No existing user's credential or entitlement changes. Both rounds must put every actor under 5000ms. The first acceptance language is Python; compiled-language latency is reported separately from the correctness checks.

Coordinated production rollout pauses and drains the prior execution scope, deploys private workers while execution remains paused, applies the additive digest migration and refreshes the existing restricted runtime role's object grants, updates the API's scope secret and code, then activates the new private generation. No active or checkpointed old-scope job can cross the scope update. Queue intents remain durable during maintenance.

Final 64-lane controlled timing fixture: 2.41–2.63s per user for eight simultaneous twenty-case runs, median 2.60s. This demonstrates orchestration capacity with injected 500ms sandbox time; it is not Cloudflare cold-start evidence. Portable runners expose QUOREM_RUNNER_CASE_LANES with the same bound, defaulting to one for local resource budgets.

Same-protocol repairs may explicitly preserve stranded attempts only after pausing release controls and proving every retained job fence matches the exact current execution scope. Foreign scopes fail closed. Recovery still uses normal signed sandbox teardown and fenced reclamation; no manual completion or teardown bypass. Child cleanup uses windows of three to reserve connection headroom.

Protocol v2 records used lanes transactionally before native delegation and checks cancellation in the same transaction. Attempt cleanup follows this durable inventory after eviction, avoiding unused sibling creation. The scope revision requires an idle transition; scope-preserving repair is insufficient for this change. Admission sends an empty stdout frame before native startup, releasing Cloudflare's pending-header connection slot. The decoder ignores that empty frame; success still requires the terminal teardown frame and EOF.

First hosted 8-user/20-case workload completed all sixteen submissions on their first attempt, but persisted admission-to-completion was 30.9–35.8s and client observation hit HTTP 503. Claims took 0.15–0.76s. This is a target miss. Startup was held behind response headers, limiting the shared drain to six pending native starts. Protocol v2 addresses this scheduling bottleneck; hosted remeasurement remains required.

Generation 9 removed the client errors but missed latency: all sixteen observations were 31–51s. Generation 10 profiling measured a 30.6s drain: 160 native calls accumulated 929s, frame verification 727s, checkpoints 23s and input references/pages 15s. These durations overlap; they are not additive wall time. A three-job single-case drain also issued 204 claim attempts. Verification must release response headers before independent work, and periodic control ticks must not refill idle slots without queued work. Admission alone does not certify either signed verification or teardown.
