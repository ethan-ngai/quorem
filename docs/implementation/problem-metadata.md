# Problem metadata

Constraints belong to the published question. The API publishes a discriminated union; prose is informational, structured constraints are enforced before execution.

| Kind         | Shape                          | Meaning                                                  |
| ------------ | ------------------------------ | -------------------------------------------------------- |
| `range`      | `target`, optional `min`/`max` | Inclusive numeric bounds                                 |
| `comparison` | `left`, `right`, `operator`    | Scalar relation between parameter values or measurements |
| `property`   | `target`, `property`           | Sequence property: sorted/nondecreasing or unique        |
| `prose`      | `text`                         | Statement guidance without executable validation         |

A target identifies a signature `parameter` and a `projection`: `value`, `length`, `sum`, `elements`, `nodeCount`, or `nodeValues`. Metadata validation rejects unknown names and projections incompatible with the declared codec. Element and node-value ranges apply to every projected value; `sum` measures a numeric list total. Comparisons use `eq`, `le`, `lt`, `ge`, or `gt`; equality compares scalar measurements, not arbitrary structures.

```json
{
  "kind": "range",
  "target": { "parameter": "values", "projection": "length" },
  "min": 0,
  "max": 10000
}
```

Nullable wrapper projections require an explicit future null policy; metadata currently rejects them. Node codecs retain their defined empty/null semantics. String length counts Unicode codepoints.

The frontend composes inline Markdown from structured shapes: parameter references use code, numbers/operators use KaTeX. Authored prose supports inline code, bold, italics and `$...$` math. Block Markdown, raw HTML, links and images stay literal; invalid or oversized math falls back to its source. Display formatting never changes numeric bounds. Prose uses ordinary statement typography. Backend enforcement is authoritative; browser checks give early feedback. Runtime codec resource ceilings remain independent safety limits.

Examples and execution cases bind positional `args` to the immutable signature's declared order. Shared frontend binding supplies names and types and rejects arity mismatches; it never invents parameter names. Positional transport remains appropriate for Python invocation and avoids duplicating a second signature in every case. Example explanations are optional metadata and survive backend decoding; they do not enter executable custom-case identity.

Published edits use the existing publication ID. Legacy string constraints decode as informational prose. Future constraints outside the supported vocabulary use prose until a validated shape is added to both backend and shared schema.

## Input presets

Parameter metadata may select a compatible editor, e.g. `input: { "preset": "matrix", "rows": 3 }`. Preset IDs resolve through an extensible class registry; classes own presentation kind, lexical acceptance, parsing, formatting and stored/editor conversion. Question overrides can supply a placeholder and 1–8 rows. Backend metadata validates preset compatibility with the wire codec. New custom wire types require a server codec; a presentation preset never expands accepted execution values.

Default controls cover numeric expressions, plain strings, boolean choices, sequences, matrices, linked lists, trees and optional values. Collection brackets stay outside editable content. Nested collections and string entries retain their typed grammar; tree gaps use `null`, with server node-shape checks unchanged. A structured preset is an explicit fallback for existing codecs, not arbitrary executable objects. Optional expected output uses add/remove actions; removal retains its draft.

Numeric expressions accept literal arithmetic, parentheses, scientific notation, exponentiation, division/floor division and modulo. No names, calls, variables or evaluation API. Input length, token count, recursion, exponent magnitude and numeric finiteness are bounded; unsafe integer intermediates are rejected instead of silently rounding. Final values must satisfy their declared codec and problem constraints. Expressions persist in browser drafts, but execution requests contain only evaluated typed values. Existing bracketed draft strings remain readable.

Run case results expose optional `stdout` and `stderr` separately from positioned diagnostics. The runner retains existing output limits; Submit never exposes these public case fields. Historical results keep their original unclassified diagnostics; new runs populate the explicit streams.

## Problem and example figures

Use a fenced `grid` or `svg` block in the problem description or in the explanation for a specific example. Put the accessible label after the fence name. Example explanations allow up to 32 KiB.

```grid Selected cell in a matrix
{"cells":[[1,2],[3,4]],"highlights":[[1,0]]}
```

In an example explanation, reference the current input by argument name to annotate the grid without copying its cells. A description figure can reference an example with the one-based `example` number.

```grid Selected cell
{"argument":"grid","highlights":[[1,0]]}
```

Grid rows must have equal length. Cells accept numbers, booleans, short text, or `null` for an empty cell. Optional `highlights` are zero-based `[row, column]` coordinates. Keep standalone `cells` for diagrams with their own data. Set `"caption":true` to show the fence label above a grid. Adjacent grids wrap side by side when space allows.

In Signature, choose **Inline** or **Rows** for a two-dimensional array parameter. Import files use `"input": {"preset":"default","layout":"rows"}`. Omit the layout for the inline default. Enable **Show grid in examples and tests** (`"showGrid":true` under `input`) to draw the current case’s array, including custom cases. Large grids are paged.

```svg Two points joined by a line
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 32" width="120">
  <path d="M16 16h88" stroke="#64748b" />
  <circle cx="16" cy="16" r="5" fill="#2563eb" />
  <circle cx="104" cy="16" r="5" fill="#2563eb" />
</svg>
```

Supply a standalone SVG with a namespace and a view box so it scales with the description. The browser renders the SVG as an image with the fence label as alt text.
