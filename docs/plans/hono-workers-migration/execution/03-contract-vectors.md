# Contract vectors (issue #338, parent #335)

Baseline: Go `d2c86b5`. Run from repository root:

```sh
go run ./apps/api/cmd/migration-vectors
go test ./apps/api/cmd/migration-vectors
QUOREM_UPDATE_MIGRATION_VECTORS=1 go test ./apps/api/internal/adapters/postgres ./apps/runner/internal/engine -run '^TestMigration(Operation|Frame)Vectors$' -count=1
go test ./apps/api/internal/adapters/postgres ./apps/runner/internal/engine -run '^TestMigration(Operation|Frame)Vectors$' -count=1
```

The command writes deterministic `fixtures/migration/{public,private}/go-oracle.json`. Each vector records input, exact output string or Go error. JSON strings containing JSON preserve numeric lexemes and exact canonical bytes. The test compares regeneration byte-for-byte and asserts source, UTF-16, SQL comparison and void-related boundaries. Synthetic private fixtures are judge-only; do not export, bundle or import them into browser contracts. No actual hidden problem data is included.

Coverage: draft/definition and case validation; four starters; integer bounds, floats, tree/list, coding NUL; CodeMirror UTF-16, combining characters, surrogate and NUL rejection; SHA-256 of UTF-8 source and Go JSON serialization (including HTML escaping and omitted/null/empty); SQL numeric, real, double, timestamps, void sequence; runtime lookup and checkpoint struct JSON. SQL comparisons check duplicates and type mismatch. Values are oracle observations, not a substitute for independent TS tests.

Decisions: retain source NUL rejection while coding case strings may contain NUL; void sequence results are ignored and normalize to null; integer JSON decimal syntax is rejected for `int`; SQL numeric is tagged and distinct from text; unordered results retain duplicates. Unknown `long` is rejected, not a supported integer type. Generic `goJSONHash` is SHA-256 of the shown Go JSON bytes, not an operation fingerprint. Do not substitute it for an operation's owning serialization and scope. Source hash is SHA-256 over exact UTF-8 bytes.

Limits: the public Go APIs do not expose interview operation fingerprinting, snapshot JSONB hashing, runner frame codecs or compressed checkpoint persistence. The checkpoint vector is Go struct serialization, not a claim about the database or frame wire format. This baseline predates migration 048; future execution contracts must enforce PR #322 head `27b09e27` attempt **and** scope fence, not infer authorization from these fixtures. The decoder writes partial output on truncated frames and invokes the exit callback before teardown is confirmed; neither observation authorizes treating the execution as safely completed. No idempotent replay, epoch/version fencing, stale writers, PostgreSQL numeric/JSONB, bytea, workerd or cross-runtime equivalence is proven here. Those require owner-level integration tests against disposable PostgreSQL and workerd. SQL publication and legacy runtime behavior differ: missing schema may be runnable but must not be published; no new compatibility path is authorized. Further vectors should cover match operation hashes/responses, compressed checkpoint frames, bigint boundaries, SQL case validation and full question publication before activation.
