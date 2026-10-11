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

The frontend renders structured shapes as mathematical code, including comparison glyphs and superscript powers. Display formatting never changes numeric bounds. Prose uses ordinary statement typography. Backend enforcement is authoritative; browser checks give early feedback. Runtime codec resource ceilings remain independent safety limits.

Examples and execution cases bind positional `args` to the immutable signature's declared order. Shared frontend binding supplies names and types and rejects arity mismatches; it never invents parameter names. Positional transport remains appropriate for Python invocation and avoids duplicating a second signature in every case. Example explanations are optional metadata and survive backend decoding; they do not enter executable custom-case identity.

New seeded metadata uses new problem version IDs. Earlier rows, drafts, submissions and workspaces remain intact; legacy string constraints decode as informational prose and retain their original codec guarantees. Existing versions do not acquire new validation rules. Future constraints outside the supported vocabulary use prose until a validated shape is added to both backend and shared schema.
