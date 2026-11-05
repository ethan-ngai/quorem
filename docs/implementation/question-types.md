# Question types

Question signatures, Odyssey methods, test cases and generated stubs share one language-neutral type vocabulary. JSON remains the wire format: absence is `null`, booleans are `true`/`false`, and collections are JSON arrays. Display literals and generated source belong to the selected language; do not replace tokens inside quoted strings.

| Pseudotype                  | Python              | Java                      | TypeScript  | OCaml      |
| --------------------------- | ------------------- | ------------------------- | ----------- | ---------- |
| `int`                       | `int`               | `int`                     | `number`    | `int`      |
| `long`                      | `int`               | `long`                    | `bigint`    | `int64`    |
| `float`                     | `float`             | `double`                  | `number`    | `float`    |
| `bool`                      | `bool`              | `boolean`                 | `boolean`   | `bool`     |
| `str`                       | `str`               | `String`                  | `string`    | `string`   |
| `datetime`                  | `datetime.datetime` | `java.time.LocalDateTime` | `Date`      | `Unix.tm`  |
| `void` (method return only) | `None`              | `void`                    | `void`      | `unit`     |
| `optional<T>`               | `T \| None`         | nullable boxed `T`        | `T \| null` | `T option` |
| `list<T>`                   | `list[T]`           | `java.util.List<T>`       | `T[]`       | `T list`   |
| `array<T>`                  | `list[T]`           | `T[]`                     | `T[]`       | `T array`  |

`int` is signed 32-bit. `long` is signed 64-bit and uses canonical decimal JSON strings from `"-9223372036854775808"` through `"9223372036854775807"`. The signature distinguishes long values from strings, including in arrays and optional values. Scalar editors accept decimal integers directly. Structured long ranges use exact integer comparisons with safe-integer bounds; the codec enforces the full signed 64-bit domain.

Datetime values are calendar fields formatted as `YYYY-MM-DDTHH:mm:ss`, years 0001–9999, with no timezone or fractional seconds. Python uses naive datetimes; Java uses LocalDateTime. TypeScript uses Date with UTC getters and setters to preserve the fields. OCaml uses Unix.tm; weekday and year-day are computed on input, and only year, month, day, hour, minute and second are compared on output. Daylight saving is false on input. Outputs with timezone or fractional seconds are invalid.

The Java judge imports `java.util.*` and `java.time.LocalDateTime`, so generated declarations use short names. Java generic primitives are boxed (`List<Integer>`, `List<Boolean>`, etc.). Legacy Java questions using arrays for `list<T>` remain executable; the harness adapts inputs to declared parameter types. New generated signatures distinguish lists and arrays. Both collections retain ordering and duplicate values by default.

Node types accept an explicit scalar payload, such as `ListNode<long>` or `TreeNode<str>`. Choose from `int`, `long`, `float`, `bool`, `str` and `datetime`. The judge reserves JSON `null` for an absent node and for holes in a level-order tree. Scalar payloads keep the node encoding unambiguous and use the same codecs as standalone values. Lists encode as arrays of payloads. Trees encode as level-order arrays and may omit trailing holes. An empty array normalizes to `null`. Use `nodeCount` with any payload and numeric `nodeValues` constraints with `int`, `long` and `float`.

Bare `ListNode` and `TreeNode` retain signed 32-bit integer payloads. Python and TypeScript use generic classes with the existing node names. Java uses `TypedListNode<T>` and `TypedTreeNode<T>` for explicit payloads so the integer classes keep their primitive `val` fields. OCaml uses polymorphic `typed_list_node` and `typed_tree_node` records with integer aliases for the bare types.

Void method return values are ignored; those calls remain in execution order and can still fail on exceptions. Tests check their state changes through subsequent value-returning methods. Examples and results show each meaningful return separately, labeled by method/call, with no void output row or editable void expectation. A returned collection remains one output value.

A collection-returning signature may set `outputOrder: "unordered"`. The judge canonicalizes only that return value's outer collection for both actual and expected output. Duplicates and nested ordering remain significant. Other methods in the same stateful test keep their own comparison policy. Omitted `outputOrder` means ordered comparison.

Frontend mappings and literal rendering: `apps/web/src/features/editor/questionTypes.ts`. Validation and codecs: `packages/questions/src`. Language execution codecs: `apps/runner/{python,polyglot}/harness.py`. Cross-language parity tests cover shared wire values. Adding a pseudotype requires updating all these boundaries together.

Odyssey starters contain a constructor and first-step methods. Unlocks append missing method stubs inside the existing `Solution` class using the selected language's parser. Existing code and methods are preserved. Collaborative insertions use the shared document's current version so simultaneous unlocks cannot duplicate stubs.

`NaryTreeNode` and `NaryTreeNode<T>` expose ordered `children` and use the same scalar payloads. Encode them as level-order child groups separated by `null`, with the root as the first group. In `[1,null,3,2,4,null,5,6]`, node 1 has children 3, 2 and 4, and node 3 has children 5 and 6. Consecutive separators mark empty child groups. Trailing separators can be omitted. OCaml exposes the `'a nary_tree_node` record.

Set a method's `nodeReferences` to `"arguments"` for reference inputs, or to `"return"` to also compare the returned node by identity. A reference pair holds a zero-based argument index and a zero-based node index in the argument's original value. Tree indices count actual nodes in breadth-first order. Indices refer to nodes before any tail links are attached and stay local to one call. References require matching declared node types.

- `{"ref":[0,1]}` as an argument passes the second node of the first argument. That argument must contain its own node values.
- `{"values":[3,2,0,-4],"tail":[0,1]}` as the first list argument connects its tail to its second node. Target another list argument to share a tail.
- In return mode, `{"ref":[0,1]}` as the expected output checks the original node instance. `null` expects no node.

### Editing node literals

Tree fields display centered levels. Each parenthesized group belongs to a non-null parent on the preceding level, in order. Whitespace is cosmetic. Groups stay compact, and the editor centers complete rows on blur.

```text
      1
  (3, 2, 4)
(5, 6) () ()
```

Use `()` for a parent with no children when a later parent has children. Trailing empty groups can be omitted when typing. Inside a child group, `null`, `_`, and an empty comma entry mark missing children. Binary groups allow up to two slots and preserve missing positions. N-ary groups remove missing slots. The formatter expands binary holes as `null` and restores leaf groups needed for the displayed level.

Node reference fields accept `parameter[index]`. Tree indices follow preorder, top to bottom through each subtree from left to right, including explicit binary holes. N-ary indices count actual nodes after missing slots are removed. For the tree above, `root[2]` selects value 5. Linked-list indices follow list order. Connect a list tail with `[3,2,0,-4] -> head[1]`. The editor translates these literals to the canonical wire values described above.
