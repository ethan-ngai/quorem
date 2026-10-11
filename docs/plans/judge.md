# Judge — Python MVP

## Harness

Confirmed: LeetCode-style Python `class Solution` methods with typed starter signatures; include ListNode and TreeNode in milestone one. Standard library, no third-party packages. Typed wire values/comparators are in contracts.md; limits in operating-defaults.md. Pin Python/runtime/stubs together during Q6; public declarations match runner and language service.

Confirmed corpus: six original seeds, two easy/two medium/two hard, arrays/strings/lists/trees. Include public examples, 20 equally weighted hidden cases, reference solution, typed signature, comparator, limits and attribution. No proprietary datasets or problem CMS.

Codecs: arrays for ListNode; breadth-first arrays with null gaps for TreeNode, trailing-null normalization. Null/empty nodes normalize consistently. Int node values; acyclic structures only. Contracts define size/depth/range checks; malformed custom input rejected before admission; malformed/cyclic output fails its case. Graph/cyclic-list/random-pointer variants deferred. Use iterative traversal where needed. Public declarations never import hidden fixtures.

## Pipeline

API validates identity, ownership, problem/language, request size, quota, and idempotency. Commit immutable submission and durable job atomically. Worker claims lease, executes with pinned Python/harness revision, persists final verdict with attempt fencing, then records outbox event. Crash/retry may repeat execution but must not overwrite a newer attempt or award duplicate results.

One queued/running job per user; atomically reject another Run/Submit while busy. Run cancellable; match Submit irrevocable; solo Submit cancellable by default. Fence cancellation and confirm teardown before releasing busy slot. Run handles public examples/custom input; Submit returns safe verdict/counts only.

Evaluate all 20 hidden cases for comparable partial scores. Fresh Solution, input objects and Python state per case prevent mutation leakage. Each case: 2 seconds wall, 256 MiB, bounded output/tasks. Contestant error scores zero for that case and other cases continue; syntax/setup contestant error scores zero for the suite. Controller/scoring faults are infrastructure errors, never contestant zeros. Total job budget 60 seconds; validate startup plus worst-case suite fits. Persist complete scores only; retry infrastructure attempts with fencing. Accepted iff all pass; otherwise stable error category from first failed case in fixed order, with full passed/total.

States: queued → running → completed; cancelled/failed alternatives. Retry infrastructure errors at most twice within finalization bounds. Lease 90 seconds, fenced attempt ID, heartbeat 15 seconds. Custom Run without expected output reports execution rather than correctness. Limits/revisions/source hash support reproducibility.

## Isolation requirements

Submitted code is untrusted. API process must not execute it or share production credentials with execution. Separate worker orchestration from execution sandbox. Each execution gets fresh scratch space, restricted privileges, no network access, read-only runtime, process/resource/output limits, no host mounts/secrets, and guaranteed cleanup. Validate isolation against escape attempts, infinite loops, fork/process storms, filesystem access, and excessive output.

Local containers support trusted development, not public isolation certification. Public target: gVisor on dedicated Linux EC2 runner hosts behind ExecutionEngine. Q11 validates host isolation, runtime, cleanup, latency and cost. No inbound listener; controller consumes scoped queue/storage credentials outside sandbox and reports through authenticated internal API. No arbitrary-code API Lambda execution. If validation fails, revise ADR toward microVM/managed isolation. [gVisor production guidance](https://gvisor.dev/docs/user_guide/production/).

Trusted controller keeps full hidden suite, expected outputs/reference solution outside sandbox. Send only current case input; contestant code can inspect it, so hidden raw stdout/stderr never returns to users. Controller parses bounded result frames and compares externally; solution cannot claim its own verdict/counts. Never mount suites/credentials into execution. Hidden diagnostics are controlled categories/location only, not arbitrary exception strings. Public/custom Run may return bounded escaped diagnostics. Hidden raw diagnostics stay transient; application logs contain safe metadata.

## Contract

ExecutionEngine accepts immutable execution spec: source, language/runtime/harness revisions, test suite reference, resource limits, job/attempt ID. Returns normalized verdict, safe diagnostics, resource measurements, and engine failure separately. Queue transport and cloud storage stay outside scoring logic.

## Acceptance

- Correct, wrong, syntax-error, exception, timeout, memory/output-limit fixtures yield stable normalized verdicts.
- Submission snapshots and runtime revisions reproducible; public versus hidden result redaction tested.
- Full-suite partial scores comparable across failed/time-limited cases; fresh objects/Solution per case; expected outputs/comparator not contestant-readable.
- Worker death and duplicate delivery recover; expired attempt cannot finalize over a newer lease.
- API/DB secrets absent from sandbox; network/filesystem denial and cleanup verified.
- Busy system rejects or queues within declared bounds; one user cannot consume all execution capacity.
