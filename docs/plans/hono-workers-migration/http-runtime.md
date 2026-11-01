# Hono and runtime composition

[Plan index](README.md)

- Use ESM, strict TypeScript, `unknown` at trust boundaries, discriminated unions for commands/results, explicit `Promise` returns and small functions. Branded IDs only where they prevent real cross-entity mistakes. No pervasive casts or `any`.
- Compose domain subapps with `app.route()`. Define route handlers next to literal paths to retain inference; use `createFactory().createHandlers()` only where reusable handlers justify it. No translation of the giant Go `Server` or composed mega-repository. [Hono guidance](https://hono.dev/docs/guides/best-practices).
- Inject semantic dependencies through factories/typed context. Business functions receive principal, command and narrow ports; never Hono `Context`, `Env`, `ExecutionContext`, `DurableObjectStub`, SDK clients or `process.env`.
- Worker bindings are typed/generated in the Worker shell. Build request/invocation-scoped database dependencies there; keep only immutable configuration/schema objects globally. No cross-request socket/client ownership.
- Validate path/query/body once. Reuse existing Zod/auth and JSON Schema/question contracts. Choose one runtime validator per existing schema family; no parallel hand-maintained Zod and OpenAPI definitions. Freeze schema generation ownership before parallel work.
- Retain reviewed OpenAPI/generated `openapi-fetch` clients for browser compatibility. Do not add Hono RPC as another public source of truth during the migration. Domain models and public DTOs need not be identical.
- Centralize expected application error mapping, validation errors, not-found/method behavior and redacted unexpected failures. Preserve status, error codes, request IDs, retry semantics and security headers. Never expose SQL/provider exception text.
- Use Web `Request`, `Response`, `fetch`, streams, `AbortSignal`, Web Crypto where appropriate. Runtime-specific libraries stay in adapters. Hono timeout middleware alone does not cancel SQL, sandbox work or rolled-back transactions; propagate cancellation deliberately.
- Middleware order is explicit: request identity/logging, host/origin policy, bounded body handling, authentication, authorization/rate limits, validation/handler, error mapping. WebSocket upgrades need their own compatible path; response-header middleware must not break upgrades.
- Runtime shells supply trusted client IP/proxy metadata; never trust arbitrary forwarded headers or `X-Dev-User` on public Workers. Development identity is available only in explicitly local shells. Preserve cookie guest CSRF/origin checks, credential precedence, no-store responses and multiple `Set-Cookie` headers.
- Distributed admission/rate/window limits use shared authoritative storage. Per-isolate counters only bound local resource use; they cannot enforce per-user or fleet-wide quotas. Normalize units/configuration once in composition, avoiding scattered defaults across HTTP, DO and judge shells.
- Use `vp` tooling. Pin versions after the runtime spike; use current APIs rather than copying snippets for older Hono/Workers versions. Comments explain invariants and surprising decisions, not every translated line.
