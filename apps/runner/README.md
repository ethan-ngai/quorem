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
