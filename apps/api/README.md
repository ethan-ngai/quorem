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

Draft saves lock their workspace, assign server revisions, and reject older
session sequences. History retains 100 accepted revisions for 30 days. Restore
creates a new revision. PostgreSQL enforces one nonterminal execution per owner;
admission resolves idempotency before busy checks, then applies token-bucket,
daily, and global queue limits.

Integration tests require a **disposable** database; they truncate product tables:

```sh
QUOREM_TEST_DATABASE_URL=postgres://quorem:quorem@127.0.0.1:54329/quorem_api_tests?sslmode=disable go test ./apps/api/...
```
