# Python language intelligence — milestone one

Delivery model superseded by [browser-first IntelliSense](intelligence-model.md): browser engines first, paid hosted engines held behind disabled flags. The capability and isolation requirements below remain.

Confirmed: CodeMirror 6, separate local backend language service, provider-neutral transport. Required: type-aware completion, hover documentation, signature help, syntax/type diagnostics. Definition navigation, references, rename, formatting deferred. Cloud hosting later.

## Capability spike

Evaluate a maintained open-source Python language server against required features and Python/runtime version. Candidate Pyright/basedpyright must pass actual capability checks; do not assume VS Code's extension functionality is included. Record pinned version, license, startup/memory footprint, stdlib stubs, and dependencies. If formatter/refactoring/navigation later need a second tool, that stays outside current scope.

## Session contract

Go application authenticates owner, validates document sizes/rates, and brokers a private session to the language-service adapter. LSP document IDs are server-assigned virtual files scoped to owner/session; accept no host filesystem paths. Separate bounded workspaces, public Python declarations, no execution credentials or hidden test access. Language service analyzes source; never executes submitted code. Provider's process/transport details remain outside problem/match domain logic.

Open/init → versioned document changes → completion/hover/signature/diagnostic exchange → close/idle cleanup. Discard obsolete document revisions. Bound requests, debounce diagnostics; reconnect preserves source/cursor/undo/drafts. Completion edits use editor transactions preserving undo. Popovers remain keyboard-usable. One active language session per owner; a second tab takes over explicitly and prior session falls back to basic completion, never leaks/shared-mutates document state. Session/resource/latency limits are in operating-defaults.md.

Public virtual environment includes pinned stdlib stubs and matching Solution/ListNode/TreeNode declarations. Problem-specific signatures expose only documented public types. Starter code should resolve without false undefined-name errors. Prevent symbol/type caches crossing owner/workspace boundaries. Never render language-server Markdown as arbitrary trusted HTML.

## Acceptance examples

- Typed list/string receiver produces appropriate member suggestions; selecting completion changes source correctly and can be undone.
- Hover on a builtin/user symbol provides type/documentation; call site shows correct argument signature.
- Syntax error and incompatible typed assignment yield correctly located diagnostics; fixing them clears diagnostics.
- ListNode.next and TreeNode.left/right reflect nullable node types consistent with runtime/harness.
- Rapid edits, stale diagnostics, service restart, reconnect, idle expiry preserve the editing buffer and eventually restore intelligence.
- Two owners with similarly named files/symbols cannot observe each other's source or suggestions.
- Measure cold session startup, warmed completion latency, document synchronization throughput, and per-session memory against agreed budgets.

## Ownership

Q5a owns adapter/gateway and extension factory, not Q5's EditorView lifecycle. Spike/adapter work follows Q3 and public harness declarations; integration follows Q5's frozen PythonEditor seam. Coordinate Q6 runtime/type declarations. Publish capability evidence before freezing server choice; no cloud account required.

Sources: [CodeMirror LSP API](https://codemirror.net/docs/ref/#lsp-client), [basedpyright docs](https://docs.basedpyright.com/latest/), [Pyright repository](https://github.com/microsoft/pyright).
