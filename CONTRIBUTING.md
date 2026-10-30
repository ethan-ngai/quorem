# Contributing to Quorem

Use [GitHub issues](https://github.com/ethan-ngai/quorem/issues) for bugs and feature proposals. Include reproduction steps, expected behavior, and relevant logs. Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## Local setup

Install Vite+ (`vp`), Node 24.21.0, Go 1.27.1, Python 3, and Docker. Start Docker, then run:

```sh
make install
make dev
```

Use local fixtures; cloud credentials are unnecessary for local development. See [README.md](README.md) for sign-in and local services. `make reset` deletes the local database volume.

Use `vp` for TypeScript tooling. Iterate with the live development server:

```sh
vp -C apps/web dev
vp -C apps/marketing run dev
```

## Changes

- Read [AGENTS.md](AGENTS.md) before editing. Link substantive work to an issue.
- Follow [DESIGN.md](DESIGN.md) for UI changes; prioritize the editor.
- Read [architecture](docs/plans/architecture.md) and [platform adapters](docs/implementation/platform-adapters.md) before backend or infrastructure work.
- Inspect analogous code and consumers. Put shared behavior in its existing owner; remove obsolete paths and unnecessary compatibility code.
- Preserve unrelated local changes. Never commit credentials, private data, or local configuration.

## Validation

Run checks relevant to the change. Before integrating code, run:

```sh
make check
make build
```

PostgreSQL integration tests truncate data. Set `QUOREM_TEST_DATABASE_URL` to a separate disposable database, never the running development database. Auth tests must likewise use a disposable `AUTH_TEST_DATABASE_URL`. See [.github/workflows/ci.yaml](.github/workflows/ci.yaml) for CI setup and additional checks.

Include validation results and known limitations with your contribution. UI changes should include screenshots; behavior changes should include focused tests where useful.

## Git workflow

`dev` is the integration branch. Maintainer solo work commits and pushes directly to `dev`; external contributors open pull requests targeting `dev`. Use conventional commits, such as `docs(repo): clarify local setup`.

Keep contributions focused. Pull request descriptions use `Changes` and `Validation`; add `Dependencies` or `Limitations` only when needed. Follow [AGENTS.md](AGENTS.md) for coordinated concurrent work.

Merging `dev` into `main` requires explicit maintainer authorization. Provision infrastructure with Terraform; deploy through GitHub Actions. Local checks do not establish hosted sandbox isolation or production readiness.
