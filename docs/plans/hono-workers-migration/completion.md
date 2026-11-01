# Go retirement and completion

[Plan index](README.md)

- Every inventory entry has an active TS owner and passing behavior/security coverage. No fake handler, TODO port, unassigned CLI or silently dropped provider capability.
- API/auth HTTP and browser socket authorities run natively on Workers; Node shell runs the same application locally without Cloudflare credentials.
- Trusted judge and language gateway are TypeScript; isolated language/SQL harnesses retain validated semantics. Hosted isolation/teardown evidence passes independently.
- PostgreSQL data, migrations, identity bindings, existing sessions, hashes, idempotency, immutable references, guest budgets, lossless records and checkpoints survive upgrade and supported rollback.
- Durable event/deadline/job recovery succeeds through crashes and exhausted transport retries; no Worker request owns a permanent listener/background loop.
- Remove superseded Go API/worker/runner/language gateway files, Go oracle code after fixtures freeze, `go.mod`/`go.sum` when no source requires them, obsolete build images and Go CI/setup.
- Remove app-container routing/pool/lease/nginx/startup machinery only after API/auth native cutover. Keep judge/case container machinery that remains in use. Consolidate old relay/scheduler paths; preserve live DO migration history/resources until drainage permits retirement.
- Search all workflows/scripts/docs/Dockerfiles for `go run`, `go build`, Go imports, embedded Go snippets, old API commands, obsolete flags and duplicate serializers/defaults. Replace consumers before deletion.
- Update architecture, provider adapters, auth/API/runner READMEs, database operations, root plans/index, local `make dev`, configuration examples, deployment recovery, Terraform and runbooks to the final topology.
- All work linked to migration issues; concurrent PRs merged into `dev`; no stale dependent branches/worktrees. Preserve unrelated `scripts/dev.py` changes throughout.

The critical path is contracts/runtime proof -> transactional storage/codecs -> identity/durable work -> admission and interview consistency -> socket/runtime integration -> hosted cutover. Parallelism helps domain slices after those contracts stabilize; it cannot replace those gates.

Drizzle adoption is complete only when product, auth and trusted judge repositories use the agreed backend schema/transaction owner; no independent hand-written table interfaces or parallel migration history. ORM entity shapes never become accidental browser payloads.

Extension readiness is complete when current query/retrieval contracts have real PostgreSQL implementations and conformance tests, with future cache/search behavior specified. No unused framework, no-op adapter, KV resource, embedding generation or vector index is required.
