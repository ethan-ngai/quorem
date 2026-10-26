# Judge latency

Work ledger: [#189](https://github.com/ethan-ngai/quorem/issues/189).

## Local baseline

Measured 2026-10-25 at `c3d89d05a61556617c16b3d7a26b09eba8079db7`, before Docker Engine API and compiled-artifact reuse changes. `Docker.Execute` used its default local images and a fresh sandbox for every case; Java, TypeScript and OCaml compiled separately for every case. Every result was accepted, with expected hidden and public sample counts checked.

Median of three timed executions per cell, milliseconds:

| Language   | 1 hidden case | 4 hidden cases | 4 hidden + 2 public samples |
| ---------- | ------------: | -------------: | --------------------------: |
| Python     |         174.2 |          707.6 |                        1101 |
| Java       |         601.8 |           2475 |                        3691 |
| TypeScript |         634.3 |           2563 |                        3813 |
| OCaml      |         184.1 |          778.7 |                        1158 |

The fixture is a trivial `solve(value: int) -> int` returning `value + 1`. The samples are separate sample results, excluded from the hidden score. Measurements include sandbox startup, compilation where applicable, execution, output comparison and confirmed teardown. They exclude API admission, PostgreSQL, queue residence, worker claim/completion, network delivery and browser rendering. Images were already built/present; these are not image-pull or first-boot measurements. Go's fixed-iteration benchmark performs a preliminary execution before its three measured iterations.

Host: Apple M5 Pro, macOS arm64, 15 CPUs, 24 GiB host memory; OrbStack Linux VM with 15 CPUs and approximately 11.7 GiB memory; Docker 29.8.2 arm64; Go 1.27.2 darwin/arm64. Each sandbox retained the default one CPU and 256 MiB memory limit. Other application activity may affect local timings. This is local development evidence, not Cloudflare container performance, production concurrency capacity, or a latency SLA.

Baseline image identities:

| Image                     | SHA-256 ID                                                         |
| ------------------------- | ------------------------------------------------------------------ |
| `quorem-python:local`     | `e9310b8ee6f1ecb41929e23b04ff588b77342384f3add960494aa92c27941bf8` |
| `quorem-java:local`       | `d4a3381622b40a13e2313843a6ac7390f9c79dd117fe793753c0b95fc98d4954` |
| `quorem-typescript:local` | `c7faedece7d952e05cca66ae5371e20e72a0e9cec5e94bf10078ca2d1b94509c` |
| `quorem-ocaml:local`      | `fbec60a84cde55a842b8e4fae7157337d894d2ee60b9034b539aad343c985969` |

## Reproduce

From the repository root with Docker running, build the current checkout's runtime images and run the benchmark:

```sh
docker build -t quorem-python:local -f apps/runner/Dockerfile .
docker build -t quorem-java:local -f apps/runner/Dockerfile.java .
docker build -t quorem-typescript:local -f apps/runner/Dockerfile.typescript .
docker build -t quorem-ocaml:local -f apps/runner/Dockerfile.ocaml .
QUOREM_TEST_DOCKER=1 go test ./apps/runner/internal/engine \
  -run '^$' -bench '^BenchmarkDockerExecuteLatency$' \
  -benchtime=3x -count=1 -timeout=15m
```

Read `median-ms/op`, not `ns/op`, for the table's statistic. The benchmark also reports min/max milliseconds; `ns/op` is Go's mean. It deliberately uses the current default `Docker` implementation, so rerunning after engine changes measures that implementation. Compare on the same machine with the same base runtimes, limits and workload; rebuild images when the harness changes. Run without competing benchmark/test loads. Do not mix a new harness image with an old engine when claiming a before/after improvement.

## Operational timing

The worker emits one `Judge execution timing` log per claimed execution attempt, including attempts with unconfirmed teardown:

- `language`: allowlisted runtime language, or `unknown`.
- `claim_ms`: database claim-call duration; excludes time waiting in the queue and preceding reconciliation.
- `execute_ms`: engine call duration, including input resolution, compilation, case execution and teardown.
- `complete_ms`: durable completion-call duration; zero when teardown prevents completion.
- `total_ms`: claim-call duration plus worker execution/completion elapsed time.
- `cases`, `samples`: aggregate returned-result counts; partial/failed executions may return fewer results.
- `outcome`: `completed`, `engine_unavailable`, `teardown_unconfirmed`, or `completion_unavailable`. A completed attempt can have a contestant failure verdict.

These logs omit source, inputs, outputs, diagnostics, credentials and user/job/submission/attempt IDs. Durations are rounded down to milliseconds. Queue residence cannot be measured from the current `execution.Job`, which has no admission/availability timestamp; `claim_ms` must not be presented as queue wait. Production end-to-end measurement still needs admission-to-result tracing or aggregate queue-age instrumentation without exposing private contents.

## Optimized execution

Measured at `e90b041` on the same local host and limits, with no competing test or benchmark load. Same three measured iterations and warm-image setup as the baseline; these are local medians, not Cloudflare timings.

| Language   | One case (ms) | Four cases (ms) | Four hidden + two public samples (ms) | Four-case reduction |
| ---------- | ------------: | --------------: | ------------------------------------: | ------------------: |
| Python     |         123.6 |           509.0 |                                 783.2 |                 28% |
| Java       |         570.6 |          1022.0 |                                1212.0 |                 59% |
| TypeScript |         578.8 |           892.0 |                                1087.0 |                 65% |
| OCaml      |         148.8 |           611.4 |                                 995.7 |                 22% |

The Python image is unchanged. The Go engine now talks directly to the local Docker Engine over its Unix socket, pools HTTP connections, demultiplexes the attached streams, and confirms force-removal before releasing the execution slot. It avoids the previous per-case `docker run`, `docker rm`, and `docker ps` CLI launches. Desktop context lookup may invoke the CLI once when the default Unix socket is unavailable; remote Docker endpoints are not supported by this local sandbox adapter.

Multi-case Java, TypeScript and OCaml executions compile an input-independent wrapper once. The first sandbox both compiles and executes its current case, avoiding an extra compiler-container startup. Its bounded artifact is captured before contestant execution and reused in later fresh containers. Single-case executions retain their simpler path because they already compile once. If a case is killed before the artifact is returned, later cases can recompile within the remaining compilation budget, preserving partial scoring.

Every case retains a fresh process, filesystem and bounded container. There is no cross-submission cache or shared writable sandbox. Artifacts contain submitted code and type adapters, never case inputs or expectations; each invocation receives only its current input. Artifacts stay in runner memory, are limited to 4 MiB, and never enter public results or durable submission records. Public-sample and hidden-suite scores remain separate. Trusted artifact preparation occurs before the contestant wall-time marker.

Validation: the complete actual-Docker engine suite passed with `-race` (111 seconds), including deployment preflight, codec/stateful parity across all languages, fresh state/filesystems, limits, cancellation, cleanup and private-result boundaries. Additional regressions cover compilation reuse, first-case timeout recovery, malformed artifacts and contestant attempts to overwrite the cached artifact. Worker/execution/architecture race tests passed. Cloudflare end-to-end timings and any infrastructure changes remain separate deployment validation.

Optimized image identities:

| Image                     | SHA-256 ID                                                         |
| ------------------------- | ------------------------------------------------------------------ |
| `quorem-python:local`     | `e9310b8ee6f1ecb41929e23b04ff588b77342384f3add960494aa92c27941bf8` |
| `quorem-java:local`       | `38c6e39b6710dd34808e5d9de030a39ee3f08a1ec959358696bc6bf6eada76e4` |
| `quorem-typescript:local` | `1a1ea2ba7889287de77e2e2f8f51e2b7504244ba269f498eab42185de03fb406` |
| `quorem-ocaml:local`      | `3f750db7d31a4fb166a24aaf2df209c0c479c67a4ca8e6f658a5ddaddfbcef4b` |
