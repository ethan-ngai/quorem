# Local solo API

From repository root:

```sh
make database
make seed
make api
```

`make dev` starts the API and runner together. API binds `127.0.0.1:8080`;
`DATABASE_URL` defaults to local PostgreSQL on port 54329. Startup applies
versioned migrations and seeds immutable problem versions. `-seed` exits after
those operations. Git fixture revisions use new version IDs; old workspaces
remain attached to their original version.

Local identity: `X-Dev-User: alice` or `bob`, default Alice. The service refuses
non-loopback binds and any `APP_ENV` other than `local`. Production identity is
outside this milestone.

Workspaces retain metadata only. Draft source and history live in the browser;
Run/Submit send immutable source snapshots for judging. No draft-saving endpoints
or server draft/history tables remain.

Integration tests require a **disposable** database; they truncate product tables:

```sh
QUOREM_TEST_DATABASE_URL=postgres://quorem:quorem@127.0.0.1:54329/quorem_api_tests?sslmode=disable go test ./apps/api/...
```

Problem constraints use typed ranges, scalar comparisons, numeric ordering/uniqueness,
and informational prose. Targets name signature parameters; unsupported projections,
duplicate names, malformed shapes, and unknown properties fail validation. String
length counts Unicode codepoints; node count excludes null tree slots. Optional
wrapper projections remain unsupported until nullable semantics are defined.

Structured fixture metadata ships as new immutable problem versions and IDs. Seed
never overwrites prior versions. Existing workspaces continue their original version
and guarantees; legacy string constraints decode as informational prose. New versions
bound each string to 10,000 codepoints (the earlier generic collection prose did not
bound strings). Example explanations remain public metadata and are omitted from
execution cases, hashes, and result ordering. Prose guarantees are informational,
including aggregate sums and level differences.

### Normalize retained result sidecars

After applying product migrations through 060, stop and drain every legacy result writer and judge. Configure `QUOREM_OPERATOR_DATABASE_URL` with the privileged database connection and `AUTH_ORIGIN` with the issuer of the verified bootstrap administrator. Preview a bounded batch, then acknowledge the drain and repeat the same command until `complete` is `true`:

```sh
make backfill-results ARGS='--op-id result-cutover-1 --reason cutover --limit 16 --max-batches 100 --dry-run'
make backfill-results ARGS='--op-id result-cutover-1 --reason cutover --limit 16 --max-batches 100 --legacy-drained'
```

The command normalizes retained legacy result headers and cases before repairing missing public status sidecars. Each source is locked and committed separately; a malformed or conflicting source fails the command. `--limit` is at most 64 and `--max-batches` at most 1000. Exit 2 means more work remains; rerun with the same operation ID and arguments. Dry run rolls writes back and previews one item, not the whole dataset. On interruption, the command reports observed committed counts and marks the current outcome unknown; retry with the same operation ID to reconcile. The drain flag is an operator assertion, not an automatic drain. Keep old writers stopped until activation and verify `complete` before serving normalized readers.
