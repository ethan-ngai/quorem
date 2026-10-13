# Question authoring and editorials

Issues: #14, #34–#37. Auth/login precedes admin implementation.

- `/login`: real Better Auth sessions. Local preview uses seeded username/password accounts; deployed login uses Cognito. Application JWTs stay in memory; Go checks live sessions and server-owned roles.
- `/admin/questions`: create or fork drafts; edit statement/topics/signature/constraints/examples/20 hidden cases, per-language templates/private references/editorials/Big-O definitions. Save explicitly, then publish. Invalid JSON blocks save/preview; publication validates supported codecs/pins/bounds. Draft listing uses 50-row keyset pages; detail is fetched only on opening.
- Publishing locks the draft and slug, creates a fresh immutable version and all artifacts/editorials, seals it, advances the publication pointer and consumes the draft atomically. Existing workspaces/submissions/matches keep their version IDs. Published drafts are read-only; create next version to edit.
- Practice and active matches select Python/Java/TypeScript/OCaml independently. Match language changes retain per-language workspaces, private browser drafts and pinned execution revisions; busy/closed/forfeited participants cannot switch.
- Practice solutions are temporarily removed. Complexity starts hidden, uses the Topics eye toggle, and renders Big-O plus free variables with LaTeX; existing plain-text publication notes are annotated for display. Cost-only requests never return code. Editorial source is explicitly published separately from judge references. Authenticated active participants are denied editorial API access; anonymous public editorial access is not an anti-cheating boundary.
- Initial editorial fixtures are pinned to bundled immutable IDs, so restarting never injects old solutions into later admin publications.

## Local validation

Run `make dev` for the complete default stack with authenticated API, realtime and language gateway. Local credentials and service secrets are generated once into ignored `.local/auth-preview.json` (owner-readable permissions). Sign in as `alice` (admin) or `bob` (regular user) using its `AUTH_SEED_PASSWORD`; restart preserves their subjects/passwords. `AUTH_MODE=password` requires explicit local loopback configuration; Cognito is mutually exclusive. Worktree UI ports can configure `WEB_ORIGIN`, `API_ADDR` and `AUTH_SERVICE_URL`.

The guarded local seed grants Alice admin in the product database using immutable issuer/subject bindings. Browser flags never grant roles. Deployed accounts require explicit database grants.

Guests may browse questions and edit code. IntelliSense and execution require sign-in; Run/Submit prompts preserve the current question route. Development identity switches are absent from product UI.

Evidence: fresh/backfill/sealing/atomic rollback/role/revision tests on disposable PostgreSQL; Docker language corpus/codec/limit/isolation tests; web/auth tests and builds; live Vite admin edit/save/preview/publish and multilingual execution/disclosure. Production build does not replace the live editing server.

## Remaining release gates

Actual Cognito callback, email verification/reset and Google federation require cloud evidence under #15. Local auth tests exercise the real Better Auth handler with fixture sessions, redirects, JWT/JWKS and logout. Publication validates metadata/cases; it does not automatically compile or judge newly authored reference/editorial sources. Administrators must verify those artifacts before public release. Public sandbox isolation/cloud deployment remains separately gated.
