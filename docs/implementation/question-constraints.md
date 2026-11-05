# Input constraints

Ranges and comparisons accept `quantifier: "all" | "any"`; omission means `all`.

- `all` (`∀`): every projected value satisfies a range; every left/right value pair satisfies a comparison.
- `any` (`∃`): at least one projected value or pair satisfies the rule.
- Empty projections satisfy `all` and fail `any`.

Numeric scalar operands broadcast against array elements or node values. Comparisons between two sequences quantify their cross-product, rather than matching positions. Evaluation uses extrema or a membership set, avoiding quadratic pair enumeration. Integer projections retain exact comparisons with `long` values.

Range endpoints independently use `minInclusive` / `maxInclusive`; omission includes the endpoint, `false` excludes it.

Ordering properties accept `direction: "asc" | "desc"`; omission means ascending. Equal adjacent values are allowed in either direction. `unique` independently requires distinct values and does not accept a direction. The authoring UI presents the equivalent `sorted` and `nondecreasing` metadata as one ordering choice.

Schema definitions live in the OpenAPI contract. Shared predicates in `packages/questions/src/constraintPredicates.ts` serve both judging and browser validation. Public formatting preserves existential quantification and ordering direction.

## Reflexive comparisons

Identical scalar operands are rejected: every operator is a tautology or contradiction. Identical sequence operands have cross-product semantics:

| Quantifier | Allowed operators | Meaning |
| --- | --- | --- |
| `all` | `=`, `≤`, `≥` | All values equal; empty sequences pass. |
| `any` | `<`, `>` | At least two distinct values; empty sequences fail. |

The remaining self-combinations are rejected. For presence or emptiness, constrain length or node count directly. Authoring omits invalid operand/operator choices and explains invalid retained drafts. Browser validation and publication admission consume the same semantic rules.

`constraintTargetOptions` builds the typed operand catalog. `comparisonChoices` derives each field's valid domain from its current partners using `comparisonRelations`, the same policy admission enforces. Choice derivation is linear in target count; it does not enumerate an n-variable Cartesian product. Reflexive sequences select quantifier and operator as one valid mode, avoiding impossible intermediate combinations.

## Authoring conflict diagnostics

An existential node-value rule fails for empty trees even when its bounds span the entire integer range. The editor identifies the conflicting rule, example/private test number, and participating input fields. One diagnostic feeds the constraint notice, case/input notices, and page-wide saving summary. Origins are registered independently, so resolving one case does not hide other conflicts.
