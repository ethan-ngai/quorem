# Question JSON import

Ledger: [#139](https://github.com/ethan-ngai/quorem/issues/139).

Question editor → Bulk import checks each file and creates a draft for new content. An unchanged publication is skipped. Changed content with a matching LeetCode ID creates an update draft for review. Ambiguous matches require review. Applying an update checks that the target publication is still current and has not changed since import.

Use [question v1 JSON Schema](../../packages/contracts/questions/question-v1.schema.json) and [complete example](../../packages/contracts/questions/example-v1.json). The schema is JSON Schema 2020-12, generated from the OpenAPI import contract and shared question definitions. `vp -C packages/contracts run generate` refreshes it; contract checks detect drift.

Write the statement and example explanations as Markdown. Use LaTeX between `$` delimiters for mathematical variables, numbers, arithmetic, comparisons, powers, and Big O. Keep program identifiers, indexing, properties, strings, and serialized arrays in backticks, including literals repeated in example explanations. Split a mixed expression at each code access. Use a language-tagged fence for multiline code (`pseudocode` if language-neutral). Put `$$` on separate lines around a standalone formula.

| Intent                       | Markdown source                   |
| ---------------------------- | --------------------------------- |
| Mathematical bound           | `$1 \le n \le 2 \cdot 10^{4}$`    |
| Indexed value                | ``$1 \le$ `nums[i]` $\le 50$``    |
| Property access and equality | `` `nums.length` $= n$ ``         |
| Allowed numeric values       | `` `grid[i][j]` $\in \{0, 1\}$ `` |
| Complexity in a sentence     | `$O(n \log n)$`                   |

Before importing, preview the statement and each example. Check that code blocks have a distinct surface, serialized values render as code, and equations render as math.

Use structured constraints for input facts. The statement renders them automatically. Reserve `prose` for guarantees outside the supported rules, such as promises about the answer or a problem-specific grammar. The editor offers conversions for recognizable notes. The fixture validator reports the same suggestions as warnings so older drafts can still be reviewed.

| Rule         | Use it for                                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `range`      | Numeric values, lengths, counts, sums, and arithmetic bounds                                                                                                                                   |
| `membership` | Allowed or excluded literals. Numeric `0` and character `"0"` are different values. Use `characters` to check each Unicode code point in a string.                                             |
| `comparison` | Relationships between measurements. Use `pairing: "corresponding"` for aligned positions, such as each interval's start and end. With pairing omitted, the relation compares all combinations. |
| `property`   | Ordering, uniqueness, parity, matrix symmetry, and graph topology                                                                                                                              |
| `definition` | Names used in the statement, such as `n` for an input's length. Naming the length of each row also requires those lengths to agree.                                                            |

An omitted `path` targets the argument itself. Each `"each"` step selects every item at that level. An integer step selects one zero-based index. For example, this rule checks every matrix cell against the same set.

```json
{
  "kind": "membership",
  "target": { "parameter": "grid", "path": ["each", "each"], "projection": "value" },
  "values": [0, 1]
}
```

Use `["each"]` with `length` for row lengths, `["each", 0]` with `value` for a tuple's first field, and `["each"]` with `elements` for a property checked within each row. Set `total: true` to sum numeric projections. An `offset` shifts the result before `operations` apply in order. The operations are `add`, `subtract`, and `multiply`. Use an integer literal or another target as the operand. Numeric sequences combine at matching positions and scalars broadcast.

Graph properties use `projection: "graph"` on a graph preset. The preset supplies direction and node count where configured. For a parent array, the binary-tree rule checks that each node has at most two children.

For remaining prose constraints, use the same Markdown conventions as the statement. Escape LaTeX backslashes inside JSON strings.

One UTF-8 JSON document per file, maximum 2 MiB. Use each object key once. Publication assigns the question ID. Import files exclude `problem.id` and `problem.version`. Omit `problem.limits` to use the standard execution limits, or supply the complete limits object. Top-level fields: `problem`, `hiddenCases`, `attribution`, `canonicalApproachId`, `approaches`. Coding questions automatically support Python, Java, TypeScript and OCaml; SQL supports PostgreSQL. Imports cannot configure submission languages, starters or runtime pins.

Classic coding owns `problem.signature`. Staged coding owns methods in each `problem.odyssey.levels` entry and derives its primary interface from the first method. SQL omits `signature`. Each authored stage owns `examples` and private `hiddenCases`; staged questions leave top-level examples/hidden cases empty. Reordering a stage moves its tests with it. Public projections remove all private stage cases.

`approaches` owns explanation, complexity and notes per algorithm; its implementations contain language and code only. `canonicalApproachId` chooses the Python judging reference (PostgreSQL for SQL), with an optional name and no configurable default language. Alternatives require names and an explicit `defaultLanguage`. Unknown properties fail validation. Repository question fixtures use the same schema. Structured constraints apply to every call of the primary coding method; other methods require their own documented rules.

Store each solution source once, under its approach. Do not include `solutions` or implementation-level `referenceSource`. Languages sharing an explanation and complexity share an approach; differing algorithms or complexity need separate approaches. The canonical approach owns the judging reference. Compact JSON reduces upload size without changing case numbers. The browser, import API, and CLI use the same lossless file decoder and generated validator. The import dialog lists field paths for invalid files and publication blockers. A structurally valid file with a publication blocker can still become a draft for repair.

Treat import files as private: they contain hidden cases and reference solutions. Public preview includes authored approaches but excludes hidden inputs and expectations. Imported IDs/version metadata are replaced by server publication metadata. Provisioning compares authored content without assigned IDs and versions; unchanged current seeds reuse their published version.

[JSON Schema](https://json-schema.org/overview/what-is-jsonschema) standardizes describing and validating JSON structures. It does not define coding-question semantics. [QTI](https://www.1edtech.org/standards/qti) standardizes assessment interchange using XML packages. This importer supports Quorem's JSON format; QTI conversion is not included.

Classic coding questions can add `signature.graphEncodings` for graph authoring. Keys are argument names, `$return`, or slots such as `$return[0]` in an ordered collection return. Cases supply a matching `graphs` map. Each graph has `directed`, explicit `nodes`, and ordered `edges` with `from`, `to`, and optional `value`. Keep distinct entries for parallel edges. Custom graphs can use integer or string node labels.

For example, set `graphEncodings.times` to `{"kind":"edgeList","directed":true,"countParameter":"n","firstNode":1,"edgeValue":"Weight"}`. A graph with nodes `[1,2,3]` and edge `{"from":2,"to":1,"value":7}` generates `times = [[2,1,7]]` and `n = 3`. Supply unrelated arguments normally. Use `args: []` when all arguments are generated, or `null` placeholders for generated arguments before other arguments. A preset return graph supplies `expected`; partial return graphs fill their indexed slots. Explicit values in generated slots must match the projection.

Presets cover edge pairs and triples, adjacency lists, binary adjacency matrices, successor arrays, and parent arrays. Indexed presets use consecutive labels, with `firstNode` defaulting to `0`. Matrices can set `matrixDiagonal` to `1` to represent reflexive connectivity. Successor and parent arrays use `-1` for a missing entry, and parent edges point from child to parent. A custom binding requires the concrete argument or expected output alongside the abstract graph. Examples and execution use the original argument and output formats. The graph supplies the diagram.

In Signature, add a graph binding for the input or output and choose its default direction. Tests opens a node and edge editor for saved preset values when they can be decoded exactly. Values that cannot round-trip stay in the native fields. Custom encodings keep the native fields alongside the graph editor.

Edges connect stable integer or text node IDs. A node can be an ID or an object such as `{"id":"A","value":[2,3]}`. Edge values and node values support JSON independently. Set `nodeValueType` or, on a custom encoding, `edgeValueType` to validate values against a question type. Preset arrays use the node IDs and the preset's native edge format. The graph card previews the generated solver value alongside the diagram.
