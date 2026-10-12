# Question authoring and editorials

Issues: #14, #34–#37. Auth/login precedes admin implementation.

- `/login`: Cognito managed account flow through Better Auth. Application JWTs stay in memory; Go checks live sessions and server-owned roles. No duplicated password store.
- `/admin/questions`: create or fork drafts; edit statement/topics/signature/constraints/examples/20 hidden cases, per-language templates/private references/editorials/Big-O definitions. Save explicitly, then publish. Invalid JSON blocks save/preview; publication validates supported codecs/pins/bounds. Draft listing uses 50-row keyset pages; detail is fetched only on opening.
- Publishing locks the draft and slug, creates a fresh immutable version and all artifacts/editorials, seals it, advances the publication pointer and consumes the draft atomically. Existing workspaces/submissions/matches keep their version IDs. Published drafts are read-only; create next version to edit.
- Practice and active matches select Python/Java/TypeScript/OCaml independently. Match language changes retain per-language workspaces, private browser drafts and pinned execution revisions; busy/closed/forfeited participants cannot switch.
- Editorial code and complexity start hidden. Cost-only requests never return code. Editorial source is explicitly published separately from judge references. Authenticated active participants are denied editorial API access; anonymous public editorial access is not an anti-cheating boundary.
- Initial editorial fixtures are pinned to bundled immutable IDs, so restarting never injects old solutions into later admin publications.

## Local validation

Run `make dev` for the complete default stack. Worktree UI ports can configure `QUOREM_API_DEV_ORIGIN`, `QUOREM_AUTH_DEV_ORIGIN` and exact loopback `WEB_ORIGIN` for the language gateway.

For an isolated admin demonstration, use a dedicated local database and explicitly grant its seeded actor with `UPDATE users SET role='admin' WHERE id='alice'`. Never grant roles from browser flags or seed administrators automatically. Managed accounts receive their role through the product database after immutable identity binding.

Evidence: fresh/backfill/sealing/atomic rollback/role/revision tests on disposable PostgreSQL; Docker language corpus/codec/limit/isolation tests; web/auth tests and builds; live Vite admin edit/save/preview/publish and multilingual execution/disclosure. Production build does not replace the live editing server.

## Remaining release gates

Actual Cognito callback, email verification/reset and Google federation require cloud evidence under #15. Local auth tests exercise the real Better Auth handler with fixture sessions, redirects, JWT/JWKS and logout. Publication validates metadata/cases; it does not automatically compile or judge newly authored reference/editorial sources. Administrators must verify those artifacts before public release. Public sandbox isolation/cloud deployment remains separately gated.
