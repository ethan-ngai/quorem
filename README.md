# Quorem

Multiplayer Python practice. A practice catalog, Showdown and Free-for-all, isolated judging, browser drafts, and Python IntelliSense.

Requires Vite+ (`vp`), Node 24.21.0, Go 1.27.1, Python 3, and running Docker. No AWS credentials.

```sh
make install
make dev
```

Open http://localhost:5173 for the Astro homepage; /practice lists questions, /practice/{slug} opens the editor, and /match/{id} opens a match. The supervisor builds both Python images, starts PostgreSQL, seeds six original problems, and starts the API, judge, language service, and web app. Alice/Bob are development identities.

`make check` checks TypeScript, contracts, editor/language tests and Go. `make build` builds apps. `make seed` restores seed data; `make reset` deletes the local database volume and reseeds it. Create a private match, open its invite in another tab, select Bob, and ready both players.

Implementation evidence and limitations: [local 1v1 verification](docs/implementation/local-1v1.md), [earlier solo checkpoint](docs/implementation/local-solo.md).

Plans and dependency-ordered tickets: [docs/plans/README.md](docs/plans/README.md), [tickets](docs/plans/tickets.md). UI rules: [DESIGN.md](DESIGN.md).

Public authentication and AWS deployment remain subsequent milestones. Development Docker isolation must pass the documented public sandbox release gate before accepting public code.

`vp run build` assembles marketing and the workspace into `apps/web/dist`. Serve `/` as `index.html`; rewrite `/practice`, `/practice/*`, `/match/*`, and `/invite/*` to `app.html`, and preserve static asset paths. `vp -C apps/web preview` implements these rules locally. Rebuild marketing after changes with `vp -C apps/marketing run build`; `make dev` builds it at startup.
