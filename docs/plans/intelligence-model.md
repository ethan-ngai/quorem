# Browser-first IntelliSense

Confirmed 2026-10-19; supersedes the server-first delivery assumption in the original Python milestone. Work ledger: [#69](https://github.com/ethan-ngai/quorem/issues/69), gateway prototype [#70](https://github.com/ethan-ngai/quorem/issues/70).

## Confirmed model

- Run IntelliSense in the browser where a maintained engine meets the required capabilities within reasonable device/download budgets. Include this in the free signed-in experience.
- Offer languages that need hosted analysis through a paid plan. Prefer local analysis even for paid users when it meets the same requirements.
- Hosted analysis stays feature-flagged off by default; deployment is on hold. No pricing, billing provider or paid entitlement implementation is authorized by this decision.
- Preserve guest restrictions: reading/editing available, IntelliSense and execution require sign-in. Judging stays isolated on the server for every language.
- Keyword/snippet completion is useful fallback editing support; it is not a substitute for type-aware completion, hover, signature help and diagnostics.

## Proposed implementation order

1. Introduce a provider-neutral editor intelligence adapter: browser Worker or hosted gateway. Preserve CodeMirror document/selection/undo and language/account-scoped isolation across changes. Lazy-load only the chosen engine.
2. TypeScript browser Worker first. TypeScript's own playground demonstrates the browser language-service/Worker approach; integrate with the existing CodeMirror editor rather than adopting Monaco. Bundle pinned standard declarations and public question harness types. Do not send source to an external service or fetch arbitrary packages.
3. Spike Python and OCaml browser implementations before categorizing either as hosted-only. Existing [Pyright Worker port](https://github.com/SardineFish/monaco-pyright-lsp) and [OCaml/CodeMirror/Merlin browser work](https://discuss.ocaml.org/t/ann-x-ocaml-notebooks-as-a-webcomponent/16996) provide candidates, not Quorem capability proof. Evaluate maintenance, pinned versions and runtime parity independently of native LSP servers. Java initially remains a hosted candidate unless a browser engine proves the same capability/performance bar. This is a candidate matrix, not a claim that any language fundamentally requires a server.
4. Implement verified server-side paid entitlements, quotas and lifecycle controls before enabling hosted languages. A Vite flag, query parameter, localStorage value or client-supplied plan never grants access. Membership checks belong before worker admission and during session renewal/revocation.
5. Resume deployment only after explicit approval and capability, isolation, load and cost evidence. Keep #71's Go gateway as the optional hosted transport; no new cloud resources now.

## Evidence gates

For each browser engine: completion edits/undo, hover, signatures, stale-safe diagnostics, public ListNode/TreeNode types, language-switch cleanup, rapid typing, Worker timeout/recovery, account switching and guest access. Measure initial download, cold startup, warmed request latency and memory on a representative lower-powered device; set budgets from evidence before shipping. Kill/restart a stalled Worker without losing drafts. Confirm no hosted socket/worker allocation in the free/default configuration.

For hosted engines: authoritative paid access on every admission, revocation, bounded user/fleet workloads, idle expiry, takeover, cleanup after crash and a measured cost ceiling. Do not show an upgrade CTA until the paid product exists.

## Current implementation status

Python now uses a local Pyright Worker through CodeMirror LSP for member completion, hover, signatures and diagnostics. TypeScript now uses its compiler in a browser Worker for type-aware member completion, hover and diagnostics. Billing remains planned. Java and OCaml default to browser-only keyword/document-word completion using CodeMirror sources; their fallback is not type-aware analysis. Guest completion remains disabled. The Go prototype currently supports hosted Python only, and is now disabled by default in the browser, gateway and local supervisor. Python and TypeScript show their browser engine status; other languages hide hosted status by default. Disabled gateways reject `/lsp` before authentication or container allocation.

Internal opt-in only:

```sh
QUOREM_HOSTED_INTELLIGENCE=true make dev
```

The local supervisor derives `VITE_HOSTED_INTELLIGENCE=true` from that server flag unless explicitly overridden. Separate web builds need the browser flag explicitly; neither flag is an entitlement. `LANGUAGE_GATEWAY=node` has the same server-side kill switch. Opt-in tests may exercise the held implementation without deploying it.

Sources: [TypeScript Sandbox and Web Workers](https://www.typescriptlang.org/dev/sandbox/), [TypeScript language-service API](https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API), [Eclipse Java language server](https://github.com/eclipse-jdtls/eclipse.jdt.ls), [OCaml editor tooling](https://ocaml.org/docs/set-up-editor). Browser-port viability remains a spike, not established by the native-server docs.

Python browser adapter pins `monaco-pyright-lsp@0.1.7` and imports only its prebuilt Worker asset, not the Monaco editor. The Worker analyzes one virtual document with bundled stdlib stubs and the public harness declarations; Python 3.12, basic type checking. It loads only for an authenticated Python workspace and terminates on document/account changes. Source stays in the browser for analysis. The upstream Worker asset is ~25.4 MB uncompressed, lazy-loaded separately from the editor bundle. This older Pyright port needs maintenance/version and device-budget evaluation before a public release; hosted deployment remains held.

The pinned worker is patched to bound ZIP central-directory and file-data copies. Its bundled ZenFS otherwise copies the remaining typeshed archive for every entry, consuming gigabytes per tab. Remove the patch only after verifying the replacement worker's real-browser memory and Python intelligence.

TypeScript uses `@valtown/codemirror-ts@2.3.1`, `@typescript/vfs@1.6.5` and the web app's TypeScript compiler. CodeMirror stays in place. The lazy Worker bundles standard declarations and public node types; no CDN, automatic type acquisition or analysis requests leave the browser. It terminates on document/account changes, with a 30-second initialization deadline. The current Worker is ~10.1 MB uncompressed; representative-device budgets remain a release gate. Verified live dot completion on an array (`map`, `filter`, `push`); compiler tests cover strings, node types and type diagnostics.
