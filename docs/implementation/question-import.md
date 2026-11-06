# Question JSON import

Ledger: [#139](https://github.com/ethan-ngai/quorem/issues/139).

Question editor → Bulk import checks each file and creates a draft for new content. An unchanged publication is skipped. Changed content with a matching LeetCode ID creates an update draft for review. Ambiguous matches require review. Applying an update checks that the target publication is still current and has not changed since import.

Use [question v1 JSON Schema](../../packages/contracts/questions/question-v1.schema.json) and [complete example](../../packages/contracts/questions/example-v1.json). The schema is JSON Schema 2020-12, generated from the reachable OpenAPI `QuestionContent` definitions. `vp -C packages/contracts run generate` refreshes it; contract checks detect drift.

One UTF-8 JSON document per file, maximum 2 MiB. Top-level fields: `problem`, `hiddenCases`, `attribution`, `canonicalApproachId`, `approaches`. Coding questions automatically support Python, Java, TypeScript and OCaml; SQL supports PostgreSQL. Imports cannot configure submission languages, starters or runtime pins.

Classic coding owns `problem.signature`. Staged coding owns methods in each `problem.odyssey.levels` entry and derives its primary interface from the first method. SQL omits `signature`. Each authored stage owns `examples` and private `hiddenCases`; staged questions leave top-level examples/hidden cases empty. Reordering a stage moves its tests with it. Public projections remove all private stage cases.

`approaches` owns explanation, complexity and notes per algorithm; its implementations contain language and code only. `canonicalApproachId` chooses the Python judging reference (PostgreSQL for SQL), with an optional name and no configurable default language. Alternatives require names and an explicit `defaultLanguage`. Unknown properties fail validation. Repository question fixtures use the same schema. Structured constraints apply to every call of the primary coding method; other methods require their own documented rules.

Store each solution source once, under its approach. Do not include `solutions` or implementation-level `referenceSource`. Languages sharing an explanation and complexity share an approach; differing algorithms or complexity need separate approaches. The canonical approach owns the judging reference. Compact JSON reduces upload size without changing case numbers. The browser importer reuses the generated standalone validator from `@quorem/questions`, avoiding runtime schema compilation.

Treat import files as private: they contain hidden cases and reference solutions. Public preview includes authored approaches but excludes hidden inputs and expectations. Imported IDs/version metadata are replaced by server publication metadata. Provisioning compares authored content without assigned IDs and versions; unchanged current seeds reuse their published version.

[JSON Schema](https://json-schema.org/overview/what-is-jsonschema) standardizes describing and validating JSON structures. It does not define coding-question semantics. [QTI](https://www.1edtech.org/standards/qti) standardizes assessment interchange using XML packages. This importer supports Quorem's JSON format; QTI conversion is not included.
