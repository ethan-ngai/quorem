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

Browser type-aware engines and billing are not implemented by this decision. Java and OCaml now default to browser-only keyword/document-word completion using CodeMirror sources; Python and TypeScript retain their bundled completion. This is not type-aware analysis. Guest completion remains disabled. The Go prototype currently supports hosted Python only, and is now disabled by default in the browser, gateway and local supervisor. The default editor hides its hosted status indicator; disabled gateways reject `/lsp` before authentication or container allocation.

Internal opt-in only:

```sh
QUOREM_HOSTED_INTELLIGENCE=true make dev
```

The local supervisor derives `VITE_HOSTED_INTELLIGENCE=true` from that server flag unless explicitly overridden. Separate web builds need the browser flag explicitly; neither flag is an entitlement. `LANGUAGE_GATEWAY=node` has the same server-side kill switch. Opt-in tests may exercise the held implementation without deploying it.

Sources: [TypeScript Sandbox and Web Workers](https://www.typescriptlang.org/dev/sandbox/), [TypeScript language-service API](https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API), [Eclipse Java language server](https://github.com/eclipse-jdtls/eclipse.jdt.ls), [OCaml editor tooling](https://ocaml.org/docs/set-up-editor). Browser-port viability remains a spike, not established by the native-server docs.
