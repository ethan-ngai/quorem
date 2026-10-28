# Question JSON import

Ledger: [#139](https://github.com/ethan-ngai/quorem/issues/139).

Question editor → Import JSON creates one new draft. Current unsaved edits must be saved first. Import never publishes or replaces another draft. Existing authoring permissions and server validation apply; publication validates typed cases, signatures and runtime rules.

Use [question v1 JSON Schema](../../packages/contracts/questions/question-v1.schema.json) and [complete example](../../packages/contracts/questions/example-v1.json). The schema is JSON Schema 2020-12, generated from the reachable OpenAPI `QuestionContent` definitions. `vp -C packages/contracts run generate` refreshes it; contract checks detect drift.

One UTF-8 JSON document per file, maximum 2 MiB. Top-level fields: `problem`, `hiddenCases`, `attribution`, `implementations`, `solutions`; staged questions may include `odysseyHiddenCases`. Each implementation includes language, starter source, runtime/harness revision and private reference source. `problem` contains the shared question definition; runtime, language and publication metadata are derived rather than repeated there. Unknown properties fail validation. Repository question fixtures use the same schema. In staged coding questions, structured constraints apply to every call of the primary (first-stage) method; other methods require their own documented rules.

Treat import files as private: they contain hidden cases and reference solutions. Public preview excludes those fields. Imported IDs/version metadata are replaced by server publication metadata. Provisioning compares authored content without assigned IDs, versions or regenerated starters; unchanged current seeds reuse their published version.

[JSON Schema](https://json-schema.org/overview/what-is-jsonschema) standardizes describing and validating JSON structures. It does not define coding-question semantics. [QTI](https://www.1edtech.org/standards/qti) standardizes assessment interchange using XML packages. This importer supports Quorem's JSON format; QTI conversion is not included.
