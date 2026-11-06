# Question authoring and editorials

Issues: #14, #34–#37. Auth/login precedes admin implementation.

- `/login`: real Better Auth sessions. Local preview uses seeded username/password accounts; deployed login uses Cognito. Application JWTs stay in memory; Go checks live sessions and server-owned roles.
- `/admin/questions`: create or fork drafts; edit statement/topics/signature/constraints/examples/1–100 hidden cases, submission runtime templates, named solution approaches with shared explanations/Big-O notes and code-only language variants; one canonical Python approach (PostgreSQL for SQL), whose name is optional. Save explicitly, then publish. The Question, Tests/Steps & tests and Solutions panels reuse interview authoring controls. Typed call sequences replace step JSON; incomplete steps can be saved as drafts. Invalid typed values block save/preview; publication validates supported codecs/pins/bounds. Draft listing uses 50-row keyset pages; detail is fetched only on opening.
- Publishing a new version advances the catalog pointer. Opening an existing version lets the author save changes to the same version ID or create a separate version. Active workspace judging and active matches must finish before the version can be changed or deleted.
- Deleting a current version requires selecting its replacement or unpublishing the question. Deletion removes question-owned content and practice result payloads, detaches workspaces, and preserves finalized match outcomes. Interview fixtures referenced by session review remain scoped to their sessions.
- Practice and active matches select Python/Java/TypeScript/OCaml independently. Match language changes retain per-language workspaces, private browser drafts and pinned execution revisions; busy/closed/forfeited participants cannot switch.
- Practice guidance offers approach selection with language-specific code and shared explanation/complexity. Complexity and source stay behind separate opt-in disclosures; cost-only responses return neither code nor explanations. Active-match editorial access and interview hint gates remain server-enforced.
- Catalog fixtures contain complete approaches and are pinned to bundled immutable IDs; restarting never injects old content into later admin publications.

## Local validation

Run `make dev` for the complete default stack with authenticated API, realtime and language gateway. Local credentials and service secrets are generated once into ignored `.local/auth-preview.json` (owner-readable permissions). Sign in as `alice` (admin) or `bob` (regular user) using its `AUTH_SEED_PASSWORD`; restart preserves their subjects/passwords. `AUTH_MODE=password` requires explicit local loopback configuration; Cognito is mutually exclusive. Worktree UI ports can configure `WEB_ORIGIN`, `API_ADDR` and `AUTH_SERVICE_URL`.

The guarded local seed grants Alice admin in the product database using immutable issuer/subject bindings. Browser flags never grant roles. Deployed accounts require explicit database grants.

Guests may browse questions and edit code. IntelliSense and execution require sign-in; Run/Submit prompts preserve the current question route. Development identity switches are absent from product UI.

Evidence: fresh/backfill/sealing/atomic rollback/role/revision tests on disposable PostgreSQL; Docker language corpus/codec/limit/isolation tests; web/auth tests and builds; live Vite admin edit/save/preview/publish and multilingual execution/disclosure. Production build does not replace the live editing server.

## Remaining release gates

Actual Cognito callback, email verification/reset and Google federation require cloud evidence under #15. Local auth tests exercise the real Better Auth handler with fixture sessions, redirects, JWT/JWKS and logout. Publication validates metadata/cases; it does not automatically compile or judge newly authored reference/editorial sources. Administrators must verify those artifacts before public release. Public sandbox isolation/cloud deployment remains separately gated.

## Private libraries

Global authoring requires the server-owned admin role. Admins choose Private or Global through the shared segmented control; private publication defaults to their own library and global publication retains recent-passkey verification in managed environments. Non-admin authors require an active `questions.custom` grant (or internal entitlement); their publications always belong to their private library. Grant through the existing operator tool:

```sh
go run ./apps/api/cmd/access grant --user '<product-user-id>' --scope questions.custom --actor '<operator>' --reason 'Private question authoring' --op-id '<unique-operation>' --ref '<tracking-reference>'
```

Practice supports `library=global` and `library=private`; omitted includes global plus the signed-in owner's questions. Owner checks also protect direct version, editorial, workspace and interview selection requests. Private authors may clone their own publications; global private references/hidden tests remain admin-only. Custom interview questions require this same capability and save transactionally to the author's library. Interview membership permits the assigned shared question, without opening the author's library.

Interview hosting defaults to one active interview. Operators may raise the bounded per-account limit with `access quota --resource interview_concurrency --value <1..100>` and the usual user/actor/reason/op-id fields. This quota remains separate from hosting/custom-authoring grants.

Coding language availability is derived from pseudotypes at publication: Python, Java, TypeScript and OCaml. SQL uses PostgreSQL only. Imported `implementations` entries cannot restrict this set; publication replaces them with generated starters and current runtime pins. Editorial language variants remain optional. Python starters annotate parameters and returns, with postponed annotations for judge-supplied node types.

Refresh existing global publications with `node apps/api/src/cli/refresh-question-languages.ts --limit 16`, using `QUOREM_OPERATOR_DATABASE_URL` and `AUTH_ORIGIN`. Preview is the default. Apply with `--apply --op-id <unique-id> --reason <reason>`; page using the returned `after` value as `--after`. Each publication refresh is atomic, audited and idempotent per operation ID; normal authoring authorization and active judging fences apply. Question identities, cases, editorial content and contestant source remain intact. Existing contestant documents retain their source; resetting to the starter uses the refreshed template. Private questions regenerate templates when their owner saves them.
