# 08 Question codecs (issue #349)

`@quorem/questions` provides lossless raw JSON numbers (`parseLosslessJson` / `stringifyLosslessJson`), coding value normalization, coding case and staged sequence validation, constraints, coding comparisons, SQL schema-bound case and result validation/comparison, and definition/publication checks. Source validity is shared with draft validation. Values containing numeric lexemes must enter as raw JSON: `JSON.parse` before these APIs irreversibly loses large integers. `JsonNumber` represents JSON number tokens; callers must not use `JSON.stringify` to serialize them.

Definition/publication functions take raw JSON, a mandatory schema-validation callback, and for publication an execution-owned runtime resolver. The callback must validate the existing question v1 JSON Schema and throw on failure; schema checks run before semantic checks. The runtime resolver must use the active execution runtime registry. Neither provider/runtime nor database dependencies enter this package. SQL and staged private cases remain data inputs and are not exported by the package.

Validation from repository root:

```sh
vp -C packages/questions run typecheck
vp -C packages/questions run test
vp -C packages/questions run test:workerd
vp env exec node packages/questions/test/node-import.mjs
vp check --no-fmt packages/questions
vp fmt packages/questions --check
```

Tests cover Go public coding and private SQL vectors, exact numeric tokens, coding constraints, void and staged calls, duplicate/order semantics, SQL types, timestamp rounding, actual public schema, a staged fixture and SQL publication. Node 24 directly imports and runs coding and SQL codecs; a native workerd smoke test imports and exercises the same public entry point. Existing tests access fixture files only at test time; no private fixture is in package exports. No database or cloud credentials are used. The new workerd test adds `@cloudflare/vitest-plugin` to package dev dependencies; the integration owner must update the root lockfile.

Limits: the workerd check is a smoke test, not the full semantic suite. SQL cases without a schema are rejected; Go can still run legacy schema-less cases, and a deliberate migration decision is required before activating this path. No PostgreSQL integration, opaque bytea sidecar persistence, historical hashes, or full corpus differential has been verified. The existing six coding fixture publications and one staged fixture pass; invalid corpus coverage is not exhaustive. Exact source bytes and lossless sidecars must remain at their owning boundaries; this package does not reconstruct historical identities. The parser and validators do not impose HTTP body limits; adapters must enforce them before parsing. Definition/publication requires upstream schema validation and a trusted runtime resolver, not placeholder callbacks. Structured constraints currently use Go-compatible IEEE-754 projections after typed coding values; SQL decimal markers remain exact. Authoring caps total staged hidden cases at 100, stricter than the old per-stage-only Go limit. Audit SQL timestamp edge cases and runtime error text against Go before activation.
