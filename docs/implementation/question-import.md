# Question JSON import

Ledger: [#139](https://github.com/ethan-ngai/quorem/issues/139).

Question editor → Bulk import checks each file and creates a draft for new content. An unchanged publication is skipped. Changed content with a matching LeetCode ID creates an update draft for review. Ambiguous matches require review. Applying an update checks that the target publication is still current and has not changed since import.

Use [question v1 JSON Schema](../../packages/contracts/questions/question-v1.schema.json) and [complete example](../../packages/contracts/questions/example-v1.json). The schema is JSON Schema 2020-12, generated from the OpenAPI import contract and shared question definitions. `vp -C packages/contracts run generate` refreshes it; contract checks detect drift.

## Identity and catalog tags

Use a descriptive title, a stable lowercase kebab-case `problem.slug` starting with a letter (up to 80 characters), and `easy`, `medium`, or `hard` for difficulty. Set `problem.leetcodeId` to the public numeric problem number for a verified LeetCode import. Omit it for original questions. Record the source and applicable attribution in the top-level `attribution` field.

| Field               | Authoring standard                                                                                                                                                                                                                                                      | Validation                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `problem.tags`      | Choose the concepts the question teaches or materially uses. Prefer existing catalog labels such as `Arrays`, `Hash Tables`, and `Binary Search`. Use one label per concept and an empty array when no topic applies.                                                   | Up to 32 nonblank tags, 64 UTF-8 bytes each. Publication rejects exact duplicates. Avoid aliases or case variants of tags already listed. |
| `problem.companies` | Include companies only when the source supports the association. Preserve source spelling and match imported associations by verified problem identity. Omit the field or use an empty array when there is no source. Treat historical tags as historical associations. | Up to 64 nonempty, trimmed names, 80 UTF-8 bytes each. Commas and case-insensitive duplicates are rejected.                               |

Use topic labels in fixtures. Values such as `foundational:arrays` are catalog filter identifiers. See the [catalog filters](practice-gallery.md) and [LeetCode staging rules](leetcode-staging.md) for alias and source matching details.

## Statement and examples

Define every input, the return value, indexing conventions, tie-breaking, and permitted output order. Check these against the source for adaptations. Explain why each public example produces its expected result. Put example-specific figures in the example explanation and use the shared [grid and SVG formats](problem-metadata.md#problem-and-example-figures).

Write the statement and example explanations as Markdown. Use LaTeX between `$` delimiters for mathematical variables, numbers, arithmetic, comparisons, powers, and Big O. Keep program identifiers, indexing, properties, strings, and serialized arrays in backticks, including literals repeated in example explanations. Split a mixed expression at each code access. Use a language-tagged fence for multiline code (`pseudocode` if language-neutral). Put `$$` on separate lines around a standalone formula.

| Intent                       | Markdown source                   |
| ---------------------------- | --------------------------------- |
| Mathematical bound           | `$1 \le n \le 2 \cdot 10^{4}$`    |
| Indexed value                | ``$1 \le$ `nums[i]` $\le 50$``    |
| Property access and equality | `` `nums.length` $= n$ ``         |
| Allowed numeric values       | `` `grid[i][j]` $\in \{0, 1\}$ `` |
| Complexity in a sentence     | `$O(n \log n)$`                   |

Before importing, preview the statement and each example. Check that code blocks have a distinct surface, serialized values render as code, and equations render as math.

## Constraints

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

Preserve the full meaning when structuring a rule. Use strict endpoints for strict bounds and matching-position comparisons for fields on the same row. Keep conditional details in prose if only part of a rule can be expressed. For example, a rule against leading zeros in multi-digit strings still permits the string `"0"`. Escape LaTeX backslashes inside JSON strings.

## File, signature, and cases

One UTF-8 JSON document per file, maximum 2 MiB. Use each object key once. Publication assigns the question ID. Import files exclude `problem.id` and `problem.version`. Omit `problem.limits` to use the standard execution limits, or supply the complete limits object. Top-level fields: `problem`, `hiddenCases`, `attribution`, `canonicalApproachId`, `approaches`. Coding questions automatically support Python, Java, TypeScript and OCaml; SQL supports PostgreSQL. Imports cannot configure submission languages, starters or runtime pins.

| Question kind  | Signature and case placement                                                                                                                                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classic coding | Set `problem.signature` with `className: "Solution"`, the method name, ordered parameters, and return type. Put public cases in `problem.examples` and private cases in root `hiddenCases`.                                                                                                                                         |
| Odyssey        | Declare methods, examples, and hidden cases on each `problem.odyssey.levels` entry. Leave `problem.examples` and root `hiddenCases` empty. Coding cases use `args: []` and ordered `calls` to methods available through that level. Put expected returns on their calls. SQL levels use an empty methods array and SQL case format. |
| SQL            | Set `problem.sql` with PostgreSQL table and output schemas and an explicit row order policy. Omit `problem.signature`. Each case has one `args` entry containing `{ "tables": [...] }`, with rows in declared column order. Put result rows in `expected.rows`. SQL constraints are informational prose.                            |

Coding `args` follow signature order. A single list input is `"args": [[1, 2]]`. Match `expected` to the declared return type. Use JSON numbers for `int` and `float`, decimal strings for `long`, and `null` for absent optional values. A void Odyssey call may omit its expected return. Use `outputOrder: "unordered"` only when the statement permits any outer list order. Duplicates and order within nested lists remain significant.

Include at least one public example and hidden case per question or Odyssey level. Choose distinct hidden inputs that cover legal boundaries, ties and duplicates where permitted, and cases that expose common wrong solutions. Check every case against every stated rule, including prose guarantees. Recompute expected outputs whenever inputs change.

## Solutions

`approaches` owns the explanation, complexity, and notes per algorithm. Explain why the algorithm works and define the variables in its LaTeX time and auxiliary space bounds. Each implementation contains `language` and `source`. `canonicalApproachId` chooses the approach with the Python judging reference, or PostgreSQL for SQL. Its title is optional and its default language is inferred. Alternatives require a title and a `defaultLanguage` present in their implementations.

Group languages that implement the same algorithm under one approach. Use separate approaches for distinct algorithms or complexity. Store each solution once under `implementations`. Order `approaches` from most to least efficient, considering time first and auxiliary space when time bounds tie. The complexity hint uses the first and last approaches with valid bounds and shows one pair when those bounds match.

Apply the statement's Markdown conventions to `explanationMarkdown` and `complexityNotes` too. Write costs as LaTeX, such as `$O(n^{2})$`, and put code accesses such as `dp[i][j]` in backticks. Use `$O(1)$` for hash-table lookup, insertion, and deletion in standard complexity analysis. Use amortized bounds for costs analyzed across a sequence of operations.

## Acceptance profiles

Every Submit uses the full hidden suite, regardless of lobby preset. High Score awards the percentage of verified cases passed. Acceptance profile case counts do not select tests.

## Native case budgets

The runner derives native time and memory budgets from the existing accepted complexity bounds, or the canonical editorial bounds when an accepted bound is absent. Use structured constraint definitions to bind complexity variables to an input length or nonnegative integer parameter. For a single array or string input, the judge can infer `n` from its length.

The judge recognizes constant, linear, logarithmic and quadratic bounds and simple sums and products. Unresolved bounds use the publication's execution limits. Republishing a question seals the inferred budget with its tests. Submit runs the full suite.

## Preflight and import

1. Compare the signature, statement, constraints, and metadata with the source for adaptations. Resolve disagreements before changing a source guarantee to fit a case.
2. Run `node apps/api/src/cli/validate.ts /path/to/question-files` and review each fixture’s diagnostics and warnings. Publication checks validate the schema, case types, and structured input rules. Review prose guarantees manually, including rules for Odyssey methods other than the primary method.
3. Verify new or changed expected outputs with a hand calculation or independent implementation. Run the reference and affected alternatives against the cases. Use the [sandboxed staging workflow](leetcode-staging.md) for imported LeetCode solutions.
4. Preview the rendered statement and examples, then create drafts with **Question editor → Bulk import** and review any publication blockers. Keep fixture files private because they include hidden tests and reference code.

## Graphs

Classic coding questions can add `signature.graphEncodings`. Use argument names for inputs, `$return` for a single return graph, or `$return[*]` for an ordered list whose graphs share one representation. Cases supply a matching `graphs` map. For a graph list, use case keys such as `$return[0]`. Each graph has `directed`, explicit `nodes`, and ordered `edges` with `from`, `to`, and optional `value`. Keep distinct entries for parallel edges. Custom graphs can use integer or string node labels.

For example, set `graphEncodings.times` to `{"kind":"edgeList","directed":true,"countParameter":"n","firstNode":1,"edgeValue":"Weight"}`. A graph with nodes `[1,2,3]` and edge `{"from":2,"to":1,"value":7}` generates `times = [[2,1,7]]` and `n = 3`. Supply unrelated arguments normally. Use `args: []` when all arguments are generated, or `null` placeholders for generated arguments before other arguments. A preset return graph supplies `expected`; partial return graphs fill their indexed slots. Explicit values in generated slots must match the projection.

Presets cover edge pairs and triples, adjacency lists, binary adjacency matrices, successor arrays, and parent arrays. Indexed presets use consecutive labels, with `firstNode` defaulting to `0`. Matrices can set `matrixDiagonal` to `1` to represent reflexive connectivity. Successor and parent arrays use `-1` for a missing entry, and parent edges point from child to parent. A custom binding requires the concrete argument or expected output alongside the abstract graph. Examples and execution use the original argument and output formats. The graph supplies the diagram.

In Signature, add a graph binding for the input or output and choose its default direction. Tests opens a node and edge editor for saved preset values when they can be decoded exactly. Values that cannot round-trip stay in the native fields. Custom encodings keep the native fields alongside the graph editor.

Edges connect stable integer or text node IDs. A node can be an ID or an object such as `{"id":"A","value":[2,3]}`. Edge values and node values support JSON independently. Set `nodeValueType` or, on a custom encoding, `edgeValueType` to validate values against a question type. Preset arrays use the node IDs and the preset's native edge format. The graph card previews the generated solver value alongside the diagram.
