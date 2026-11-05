# Editor highlighting and documentation

Issue: [#167](https://github.com/ethan-ngai/quorem/issues/167). Appearance preferences: [#166](https://github.com/ethan-ngai/quorem/issues/166).

## Ownership

- `editorColors.ts` owns palette roles and CSS-variable naming. `editorPalette.ts` supplies scheme values and editor surfaces. Each scheme defines task, documentation-comment and documentation-tag foregrounds independently.
- `syntaxHighlighting.ts` maps standard Lezer tags and their inherited subtypes to those roles. Language adapters only add grammar context absent upstream, such as method declarations and parameters. No application grammar or source-code parser is implemented.
- `commentSyntax.ts` shares grammar-based comment boundaries and language-provided delimiters. `commentAnnotations.ts` colors task text, documentation comments and tags inside those boundaries. Strings and code identifiers are excluded from task recognition.
- `semanticHighlighting.ts` renders asynchronous semantic roles independently of any compiler or LSP transport. It requests visible ranges, rejects stale responses, clears outdated spans on edits and releases timers on disposal. Scheme changes reuse CSS variables.
- `typeScriptSemanticTokens.ts` adapts the existing TypeScript worker's public 2020 classifications to shared roles. The compiler resolves parameter references, scopes, classes, properties and library symbols. Semantic requests never overwrite a newer source snapshot.

Python, Java and TypeScript retain the official CodeMirror/Lezer grammars. OCaml retains CodeMirror's upstream stream mode; it provides lexical coloring, not scope/type analysis. Python's visible identifier adapter uses upstream `TypeDef`, `TypeDefinition` and `TypeParam` ancestry to color annotations and Python 3.12 aliases, including nested generics, unions and qualified names. `Literal` arguments, `Annotated` metadata and quoted forward references keep expression/string coloring. This is syntactic context, not symbol resolution: imported names and constructor calls outside annotations are not classified as types, and builtin accents do not resolve shadowing. The bundled Pyright server has no semantic-token provider; diagnostics and completion do not imply semantic colors.

Java adds record/sealed keywords, annotation declarations, generic declarations, compact constructors, record components, inferred lambda parameters and varargs. TypeScript adds namespace and method-signature contexts before its compiler is ready. OCaml refines upstream code tokens for uppercase module/constructor names, variants, labels, characters and type variables while preserving upstream strings and nested comments; it does not classify arbitrary user-defined lowercase type references or resolve scopes. Java and OCaml have no semantic-token provider. Ordinary variable references can intentionally remain the foreground color.

PostgreSQL uses CodeMirror's maintained SQL grammar with the PostgreSQL dialect, including dollar-quoted strings and nested comments. Quoted identifiers use the shared name role rather than string coloring. Language adapters share the same palette in editable and read-only editor consumers.

## Tasks and documentation colors

TODO/FIXME and related task markers color the associated task text, starting at the marker, including indented comment continuation lines. Comment delimiters retain ordinary comment color. Blank lines, ordinary unindented comments and closed block comments end continuation. Scrolling into a continuation restores context from the adjacent comment run.

This follows [JetBrains' default TODO patterns](https://github.com/JetBrains/intellij-community/blob/master/platform/editor-ui-ex/src/com/intellij/ide/todo/TodoDefaultPatternProvider.kt) and [multiline TODO conventions](https://www.jetbrains.com/help/idea/using-todo.html). All changes affect text foreground, with no task background fill.

Documentation comments have a separate `docComment` role, documentation tags a `docTag` role, and code annotations/decorators retain `decorator`. Task text inside documentation keeps its `todo` role. JetBrains Dark uses the upstream yellow-green task accent; JetBrains Light uses contrast-adjusted blue. Solarized uses its magenta task accent. GitHub and One Dark do not define a dedicated upstream TODO scope in their base themes, so Quorem supplies explicit palette-compatible accents. Some dim upstream colors are adjusted to meet 4.5:1 contrast on editor surfaces.

## Documentation editing

`documentationComments.ts` owns language-configured scaffolding and an optional asynchronous compiler-template provider. Java and TypeScript share `/** ... */` configuration and use [`@valtown/codemirror-continue`](https://github.com/val-town/codemirror-continue) for subsequent star-prefixed lines. Python scaffolds standalone triple quotes. OCaml scaffolds `(** ... *)`, then uses upstream indentation. Native bracket/quote completion remains installed.

`documentationSignatures.ts` walks upstream syntax trees using adapter-supplied node names. Java adds parameter, declared return and throws tags for the following method; constructors and void methods omit return tags. TypeScript has grammar-based parameter/declared-return tags before its worker is ready. Once available, the existing TypeScript compiler supplies JSDoc templates through `getDocCommentTemplateAtPosition`, including inferred signature information.

Async templates apply only while the document and selection still match the original scaffold. Editing remains available if a service fails. Existing documentation is not rewritten, and no descriptions are fabricated.

## Verification

Tests exercise all standard Lezer tags, actual output from all five languages, parser-aware comment boundaries, nested OCaml comments, scrolled task continuations, palette contrast, documentation templates, native command fallback, undo, read-only behavior and real TypeScript scope classifications. Live Vite checks use real editor components and the browser TypeScript worker; temporary fixtures are removed before committing.

Cross-language type/declaration/literal regression matrix: `languageHighlighting.test.ts`. Follow-up audit: [#518](https://github.com/ethan-ngai/quorem/issues/518).
