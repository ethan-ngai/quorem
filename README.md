# Quorem

Multiplayer coding practice in Python, Java, TypeScript and OCaml. A practice catalog, Showdown and Free-for-all, isolated judging, browser drafts, experimental Python IntelliSense and admin question authoring.

Requires Vite+ (`vp`), Node 24.21.0, Go 1.27.1, Python 3, and running Docker. No AWS credentials.

```sh
make install
make dev
```

Open http://localhost:5173 for the Astro homepage; /practice lists questions, /practice/{slug} opens the editor, and /match/{id} opens a match. The supervisor builds language images, starts PostgreSQL, seeds six original problems and real accounts, and starts auth, API, judge, web, and the optional Go language gateway. Hosted IntelliSense is disabled by default; its browser-first replacement and future paid hosted delivery are [held/planned](docs/plans/intelligence-model.md). Sign in as `alice` (admin) or `bob` using `AUTH_SEED_PASSWORD` from ignored `.local/auth-preview.json`. Guests may read questions/edit code; IntelliSense, Run and Submit require sign-in.

Profile photos use private S3 storage; `make dev` starts Garage at loopback port 53900 with persisted local credentials/data. Missing photos use HTML initials. Workspace settings sits beside the profile button. See [profile storage](docs/implementation/profile-photos.md).

`make check` checks TypeScript, contracts, editor/language/auth tests and Go. `make build` builds apps. `make seed` restores problem data; `make reset` deletes the local database volume and reseeds it. Create a private match as Alice, open its invite in a separate browser profile/private window, sign in as Bob, and ready both players.

Implementation evidence and limitations: [local 1v1 verification](docs/implementation/local-1v1.md), [earlier solo checkpoint](docs/implementation/local-solo.md).

Plans and dependency-ordered tickets: [docs/plans/README.md](docs/plans/README.md), [tickets](docs/plans/tickets.md). UI rules: [DESIGN.md](DESIGN.md).

Public authentication and AWS deployment remain subsequent milestones. Development Docker isolation must pass the documented public sandbox release gate before accepting public code.

`vp run build` assembles marketing and the workspace into `apps/web/dist`. Serve `/` as `index.html`; rewrite `/practice`, `/practice/*`, `/match/*`, and `/invite/*` to `app.html`, and preserve static asset paths. `vp -C apps/web preview` implements these rules locally. Rebuild marketing after changes with `vp -C apps/marketing run build`; `make dev` builds it at startup.

IntelliSense gateway limits, local measurements and deployment/cost estimates: [Go language gateway](docs/implementation/language-gateway.md).
