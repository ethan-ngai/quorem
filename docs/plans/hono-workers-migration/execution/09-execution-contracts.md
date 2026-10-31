# 09 Private execution contracts (issue #356)

`@quorem/execution` owns server-only runtime revision pairs, source hashing, job and completion mappings, checkpoint metadata and case frames, compressed checkpoint frames, compiled artifact validation, and transport-independent engine/repository/sandbox ports. It imports question source and lossless JSON codecs; the dependency is one-way. Nothing is exported from public contracts. Job serialization follows the existing Go JSON fields and deliberately excludes `sandboxScope`; decoding requires the scope from trusted local context. Runtime and harness pairs are resolved together; the older PostgreSQL harness remains readable while admission selects the current pair.

A reclamation identity contains both `attemptId` and `sandboxScope`. Repositories must apply `assertClaimFence`, require teardown confirmation for that exact pair, and atomically check the pair, lease expiry and eligible state in the database as in PR #322 head `27b09e27`. A null confirmation permits only never-claimed jobs. TypeScript helpers cannot prove teardown or replace those database guards. Completion additionally checks claimed submission/attempt via `assertCompletion`; the job retains scope for the repository fence. There is no sandbox host, claim implementation or deployment in this package.

Frame decoding reads at most one 64 KiB frame at a time, awaits each output sink, applies caller-provided stdout/stderr caps, and returns success only after exit, teardown and EOF. Output passed to the sink before the final return is provisional and must not be committed as a successful case if decoding or teardown fails. Abort is checked between reads; the transport must also abort a pending read and own cleanup. Checkpoint case/frame JSON is kept raw; `bigint` nanoseconds do not pass through JSON numbers. One bounded checkpoint frame is gzip encoded/decoded with Web Streams; compressed bytes need not match Go's compressor byte-for-byte. Compressed rows and lossless sidecars remain opaque bytes at persistence boundaries.

Validation:

```sh
vp -C packages/execution run typecheck
vp -C packages/execution run test
vp -C packages/execution run test:workerd
vp env exec node packages/execution/test/node-import.mjs
```

The same tests run on Node and native workerd, including Go runtime/frame/checkpoint vectors, fragmented and truncated frames, source hashes, scope mismatches, stale revision pairs, compiled artifact constraints, Go gzip decompression and backpressure. No actual PostgreSQL fencing, sandbox teardown, process isolation, hosted execution or full runner integration is proven. Compressed frame output is bounded to 2 MiB; compressed input is capped at 4 MiB. The final system must exercise stale claim races, lease/cancellation/checkpoint transactions and teardown failures against disposable PostgreSQL and the real sandbox before activation.

The assigned base has an out-of-date root lock for packet 08's test plugin; `vp install --frozen-lockfile` failed. Tests used ignored package-local links to the already installed workspace toolchain. Integration must add this package, its workspace question dependency and test dependencies to the root lockfile. Formatting and lint were run with the installed Vite+ toolchain from the packet 08 checkout against the exact package path.
