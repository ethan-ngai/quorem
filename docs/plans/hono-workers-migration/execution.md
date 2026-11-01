# Judge and language execution

[Plan index](README.md)

Final judge target: trusted TypeScript/Node orchestration with an HTTP drain endpoint and local continuous mode. Hono can serve its control HTTP routes. Worker queue handlers dispatch bounded drains; sandbox execution remains behind `ExecutionEngine`/`SandboxControl` ports. Keeping Node here avoids forcing compilation artifacts, compressed replay and untrusted execution into Worker memory/CPU limits.

- Port claim/lease/heartbeat/cancel/complete/checkpoint commands with exact DB atomicity. Jobs are claimed from PostgreSQL, never selected by queue job ID. Preserve one nonterminal submission per owner, guest accounting and idempotent context validation.
- Resolve PR #322 before porting: reclamation must be fenced to the exact expired attempt whose teardown was confirmed. Preserve database guards, capability-filtered claims and fail-closed teardown behavior. Teardown failure cannot produce completion or permit unsafe reuse.
- Preserve runtime/harness revision registries and Python/Java/TypeScript/OCaml/PostgreSQL behavior, compile-once reuse, per-case isolation, output/frame caps, SQL comparators, Odyssey progression, public/private result separation and monotonic cancellation.
- Keep existing Python harnesses, launcher, cgroup/seccomp/network boundaries and language images unless tests require a specific change. Translate trusted Go orchestration; do not rewrite working harnesses for language uniformity.
- Stream sandbox frames and compressed checkpoint rows with backpressure. Replay paginated checkpoints without retaining whole suites or holding a DB connection during execution. Preserve opaque artifacts, accumulated timings, quota settlement and bounded final-result output.
- Implement separate HTTP-remote and local Docker sandbox adapters. No `child_process`, Docker socket or process supervision in the Worker bundle. Disconnect/abort and truncated-stream tests must still tear down/verify before releasing claims.
- Keep essential startup readiness distinct from behavioral isolation validation. Do not hide existing hosted teardown/truncation uncertainty by declaring a language rewrite fixes it; #317 remains a release blocker until its evidence is satisfied.
- Consolidate `apps/language` Go gateway into the existing TS owner after inspecting both implementations. Preserve authentication, opt-in/entitlements, LSP framing, backpressure, per-user/session bounds, engine pinning and process cleanup. Actual engine subprocesses stay on a process host; browser-first intelligence remains the default.
- Port Go-backed fixture/import/validation/profiling CLIs and build helpers. Audit scripts invoking embedded Go source, especially `scripts/validate-leetcode-structure.py`. Full Go retirement requires zero hidden `go run` dependencies.
