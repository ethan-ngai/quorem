# Quorem

Multiplayer Python practice. Current implementation: local solo workspace, real isolated judging, durable drafts, and Python IntelliSense.

Requires Vite+ (`vp`), Node 24.21.0, Go 1.27.1, Python 3, and running Docker. No AWS credentials.

```sh
make install
make dev
```

Open http://localhost:5173. The supervisor builds both Python images, starts PostgreSQL, seeds six original problems, and starts the API, judge, language service, and web app. Alice/Bob are development identities.

`make check` checks TypeScript, contracts, editor/language tests and Go. `make build` builds apps. `make seed` restores seed data; `make reset` deletes the local database volume and reseeds it. “Match preview” shows static 1v1 state; executions remain solo.

Implementation evidence and limitations: [local solo verification](docs/implementation/local-solo.md).

Plans and dependency-ordered tickets: [docs/plans/README.md](docs/plans/README.md), [tickets](docs/plans/tickets.md). UI rules: [DESIGN.md](DESIGN.md).

Public authentication, real 1v1, AWS deployment, and marketing remain subsequent milestones. Development Docker isolation must pass the documented public sandbox release gate before accepting public code.
