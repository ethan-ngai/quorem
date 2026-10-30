# Question types

Question signatures, Odyssey methods, test cases and generated stubs share one language-neutral type vocabulary. JSON remains the wire format: absence is `null`, booleans are `true`/`false`, and collections are JSON arrays. Display literals and generated source belong to the selected language; do not replace tokens inside quoted strings.

| Pseudotype                  | Python              | Java                      | TypeScript  | OCaml      |
| --------------------------- | ------------------- | ------------------------- | ----------- | ---------- |
| `int`                       | `int`               | `int`                     | `number`    | `int`      |
| `float`                     | `float`             | `double`                  | `number`    | `float`    |
| `bool`                      | `bool`              | `boolean`                 | `boolean`   | `bool`     |
| `str`                       | `str`               | `String`                  | `string`    | `string`   |
| `datetime`                  | `datetime.datetime` | `java.time.LocalDateTime` | `Date`      | `Unix.tm`  |
| `void` (method return only) | `None`              | `void`                    | `void`      | `unit`     |
| `optional<T>`               | `T \| None`         | nullable boxed `T`        | `T \| null` | `T option` |
| `list<T>`                   | `list[T]`           | `java.util.List<T>`       | `T[]`       | `T list`   |
| `array<T>`                  | `list[T]`           | `T[]`                     | `T[]`       | `T array`  |

Datetime values are calendar fields formatted as `YYYY-MM-DDTHH:mm:ss`, years 0001–9999, with no timezone or fractional seconds. Python uses naive datetimes; Java uses LocalDateTime. TypeScript uses Date with UTC getters and setters to preserve the fields. OCaml uses Unix.tm; weekday and year-day are computed on input, and only year, month, day, hour, minute and second are compared on output. Daylight saving is false on input. Outputs with timezone or fractional seconds are invalid.

Java generic primitives are boxed (`List<Integer>`, `List<Boolean>`, etc.). Legacy Java questions using arrays for `list<T>` remain executable; the harness adapts inputs to declared parameter types. New generated signatures distinguish lists and arrays. Both collections retain ordering and duplicate values by default.

Void method return values are ignored; those calls remain in execution order and can still fail on exceptions. Tests check their state changes through subsequent value-returning methods. Examples and results show each meaningful return separately, labeled by method/call, with no void output row or editable void expectation. A returned collection remains one output value.

A collection-returning signature may set `outputOrder: "unordered"`. The judge canonicalizes only that return value's outer collection for both actual and expected output. Duplicates and nested ordering remain significant. Other methods in the same stateful test keep their own comparison policy. Omitted `outputOrder` means ordered comparison.

Frontend mappings and literal rendering: `apps/web/src/features/editor/questionTypes.ts`. Validation and codecs: `apps/api/internal/problems/{codec,case_codec,input,languages,odyssey}.go`. Language execution codecs: `apps/runner/{python,polyglot}/harness.py`. Cross-language parity tests cover shared wire values. Adding a pseudotype requires updating all these boundaries together.

Odyssey starters contain a constructor and first-step methods. Unlocks append missing method stubs inside the existing `Solution` class using the selected language's parser. Existing code and methods are preserved. Collaborative insertions use the shared document's current version so simultaneous unlocks cannot duplicate stubs.
