# Development Python judge

```sh
docker build -t quorem-python:local -f apps/runner/Dockerfile .
go run ./apps/runner/cmd/runner
```

`DATABASE_URL` uses local PostgreSQL on port 54329. `RUNNER_IMAGE` defaults to
`quorem-python:local`; `RUNNER_CONCURRENCY` defaults to two (bounded 1–8).

The Go controller claims PostgreSQL leases, snapshots trusted fixtures, sends
only source/signature/current input into Docker, and compares returned values
outside the sandbox. Each case has a fresh process, Solution instance, and
input graph. Hidden diagnostics never persist in results or logs. Submit
executes all 20 cases and returns complete partial counts. Custom Run cases
without an expected value report `executed`.

The pinned Python 3.12.12 image runs without network, host mounts, application
credentials, root privileges, or writable root filesystem. Per-case limits:
2 seconds, 256 MiB, 16 tasks, 64 KiB streams/result. Total job budget: 60 seconds.
Development containers are not public isolation certification; public execution
requires the planned dedicated-host/gVisor validation.

Attempt IDs fence heartbeats/completions. Infrastructure failures retry twice;
expired abandoned attempts are reaped before a new lease. Cancellation releases
its owner slot only after confirmed teardown or queued nonexecution. Unconfirmed
teardown leaves the lease active for reconciliation.

```sh
QUOREM_TEST_DOCKER=1 go test ./apps/runner/internal/engine
```

Tests run correct and incorrect solutions across all six fixtures, full-suite
partial scoring, node codecs, syntax/runtime/resource failures, fresh state,
privacy/isolation probes, forged result frames, cancellation, and orphan cleanup.

Java 21, TypeScript 5.9.3 / Node 22, OCaml 4.13.1 use separate pinned base images:

```sh
docker build -f apps/runner/Dockerfile.java -t quorem-java:local .
docker build -f apps/runner/Dockerfile.typescript -t quorem-typescript:local .
docker build -f apps/runner/Dockerfile.ocaml -t quorem-ocaml:local .
QUOREM_TEST_DOCKER=1 go test ./apps/runner/internal/engine -parallel 4
```

Override images with `RUNNER_JAVA_IMAGE`, `RUNNER_TYPESCRIPT_IMAGE`, `RUNNER_OCAML_IMAGE`.
Queue jobs snapshot language, runtime and harness at admission; mismatched revisions fail closed.
Fresh sandbox per case; compilation gets a bounded 10-second phase, execution the problem wall-time limit. A submission has a cumulative 60-second compilation budget; exhaustion yields a contestant time-limit verdict and preserves already-passed cases. Syntax errors stop redundant compilation. The worker has a 120-second infrastructure envelope.
Compilers and solutions share memory, process, output, network, filesystem and CPU restrictions.
Java/TypeScript expose `Solution` methods, arrays, and `ListNode` / `TreeNode` with `val` fields.
OCaml exposes functions, lists, optional mutable records (`list_node` with `value,next`; `tree_node` with `value,left,right`).
Node values use the same JSON linked-list and breadth-first-tree codec as Python.
Java/TypeScript/OCaml have syntax highlighting; Python alone has remote IntelliSense.
Docker fixtures prove local compiler/codec behavior; cloud sandbox release validation remains separate.
