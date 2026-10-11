# Problem metadata

Constraints belong to immutable problem versions. The API publishes a discriminated union; prose is informational, structured constraints are enforced before execution.

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

New seeded metadata uses new problem version IDs. Earlier rows, drafts, submissions and workspaces remain intact; legacy string constraints decode as informational prose and retain their original codec guarantees. Existing versions do not acquire new validation rules. Future constraints outside the supported vocabulary use prose until a validated shape is added to both backend and shared schema.

## Input presets

Parameter metadata may select a compatible editor, e.g. `input: { "preset": "matrix", "rows": 3 }`. Preset IDs resolve through an extensible class registry; classes own presentation kind, lexical acceptance, parsing, formatting and stored/editor conversion. Question overrides can supply a placeholder and 1–8 rows. Backend metadata validates preset compatibility with the wire codec. New custom wire types require a server codec; a presentation preset never expands accepted execution values.

Default controls cover numeric expressions, plain strings, boolean choices, sequences, matrices, linked lists, trees and optional values. Collection brackets stay outside editable content. Nested collections and string entries retain their typed grammar; tree gaps use `null`, with server node-shape checks unchanged. A structured preset is an explicit fallback for existing codecs, not arbitrary executable objects. Optional expected output uses add/remove actions; removal retains its draft.

Numeric expressions accept literal arithmetic, parentheses, scientific notation, exponentiation, division/floor division and modulo. No names, calls, variables or evaluation API. Input length, token count, recursion, exponent magnitude and numeric finiteness are bounded; unsafe integer intermediates are rejected instead of silently rounding. Final values must satisfy their declared codec and problem constraints. Expressions persist in browser drafts, but execution requests contain only evaluated typed values. Existing bracketed draft strings remain readable.

Run case results expose optional `stdout` and `stderr` separately from positioned diagnostics. The runner retains existing output limits; Submit never exposes these public case fields. Historical results keep their original unclassified diagnostics; new runs populate the explicit streams.
