# 07 Question model slice (issue #346)

`@quorem/questions` reuses generated `@quorem/contracts/schema` types. It exports pure signature/input preset and constraint metadata validation, bounded draft validation, and classic/staged Python, Java, TypeScript, OCaml and SQL starter generation. Execution limit types come from the existing public contract; no execution, provider or database imports. Consumers must validate untrusted wire shapes against the existing question JSON Schema first: TypeScript types are not runtime schema validation. Draft validation expects normalized, complete contract-shaped objects; an incomplete authoring draft can have empty fields and collections.

Packet 08 must add case decoding, constraint evaluation, SQL and Odyssey semantic validation, and complete definition/publication validation before API authoring or judge admission uses this package. No publication success API is exposed. Runtime revision/reference and SQL schema rules also remain there or with their appropriate execution owner. No Go consumers have migrated; do not treat this slice as parity or activation evidence.

Validation from repository root:

```sh
vp -C packages/questions run typecheck
vp -C packages/questions run test
vp check --no-fmt packages/questions
```

Four starter outputs match `fixtures/migration/public/go-oracle.json`; tests also cover documentation escaping, staged no-argument OCaml, type grammar, presets, signatures, constraints and draft limits. Tests access only public synthetic vectors. These checks use the root installed toolchain and local workspace links; the integration owner must update the root lockfile for the new package and its dependencies. SQL/case numeric precision, full authoring golden parity, runtime behavior and integration remain unverified.
