# Problem expansion

Authorized 2026-10-12: plan, publish GitHub issues, then orchestrate implementation.

| Order | Issue | Contract / ownership | Evidence |
| --- | --- | --- | --- |
| 1 | [#14](https://github.com/ethan-ngai/quorem/issues/14) | Auth service, Go identity, login/logout, server admin role | Mock OAuth/JWKS/session tests; real Cognito stays #15 |
| 2 | [#34](https://github.com/ethan-ngai/quorem/issues/34) | Normalized immutable problem versions, languages, examples/cases/tags/editorials | Fresh/backfill PostgreSQL tests, preserved IDs and privacy |
| 3 | [#35](https://github.com/ethan-ngai/quorem/issues/35) | Python + Java/TypeScript/OCaml execution, language-scoped drafts | Real runtime/reference/incorrect/limits checks |
| 4 | [#36](https://github.com/ethan-ngai/quorem/issues/36) | Editorial code/explanation and complexity disclosure | Accessible reveal, language availability, match denial |
| 5 | [#37](https://github.com/ethan-ngai/quorem/issues/37) | Authenticated admin drafts and immutable publish | Forged-role denial, validation/concurrency/version tests |

Auth/login lands before admin implementation. Auth and normalized read foundations may run concurrently; dependent work consumes committed contracts. PRs remain draft and unmerged until authorized.

## Confirmed requirements

- Normalize the database for these features.
- Add Java, TypeScript and OCaml alongside Python.
- Store and show/hide time and space complexity.
- Solutions panel: desired language, code and explanations.
- Admin question editor; auth/login first.

## Engineering defaults

- Complexity means authored Big-O time and auxiliary-space expressions, with variable definitions/notes. Measured judge time/memory remain separate.
- Complexity starts hidden; reveal state resets for a new problem/version. Solutions require explicit opening; no solution leakage through normal problem payloads.
- Editorial code is separately authored/published, never automatically copied from private judge references. Initial seeds may have no editorial until an administrator authors one.
- Problems have stable identity and explicit current publication. Published versions are immutable. Publishing creates a new UUID/version; existing drafts/workspaces/submissions/matches retain their pinned version.
- Language implementation records bind starter source and runtime/harness revision to the immutable version. Only installed/validated implementations are offered for judging.
- JSONB remains for bounded structured values (typed arguments, signatures/constraints), not for duplicating entire authoritative aggregates. Migration may retain derived compatibility snapshots while callers move to normalized reads.
- Editor uses existing tokens/layout and browser-only language-scoped drafts/history. New languages get appropriate editing support; Python intelligence stays Python-only unless separately validated.
- Admin role is server-owned; development fixtures never imply production privileges. Draft authoring includes safe preview, explicit save, optimistic revision checks and atomic publish.
- Active participants cannot fetch editorial solutions for their match problem through practice routes. This does not claim to prevent external spoilers/public anonymous discovery.

## Release gates

Local tests and live Vite UI validation first, without AWS credentials. Real Cognito login/reset/social flows, deployment and public sandbox isolation remain cloud release gates under #15. Run PostgreSQL tests only against a separately named disposable database. No merge/deploy authorization implied.
