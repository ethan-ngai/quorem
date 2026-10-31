# 04: Hono foundation

Issue #342. Foundation only; no product routes or deployment.

`createApp({ allowedOrigins, requestId })` composes a portable Hono app. `ApplicationError` is provider-neutral; HTTP maps expected errors and redacts unexpected failures. Origins are exact allowlist entries (one trailing slash stripped from the request), absent origins are allowed, preflights return 204, and all responses receive a generated request ID and `no-store`. Node reads `QUOREM_ALLOWED_ORIGINS` and `PORT`; Worker reads `ALLOWED_ORIGINS`. Both default to an empty origin allowlist. `/health` is the only production route. The `check:boundaries` AST check scans application and module business files, excluding route transports and tests. Relative imports must remain in those business files; only `@quorem/questions` and `@quorem/execution` are allowed external packages. Dynamic imports and require are rejected. Runtime composition owns provider dependencies. The two canonical packages are trusted by this check and require their own boundary enforcement.

Pinned Hono 4.13.14, Node server 2.1.5, Wrangler 4.156.0, Cloudflare Vitest plugin 1.4.11; root Vite+ 1.1.0 and Vitest 5.0.3 remain unchanged. The standalone spike is excluded from root lint because it owns a separate install and lockfile.

Validation from repository root:

- `vp -C apps/api run test`: Node real HTTP listener plus boundary fixtures, 6 tests passed.
- `vp -C apps/api run test:workers`: workerd, 4 tests passed, including Worker shell composition.
- `vp -C apps/api run typecheck` and `vp -C apps/api run check:boundaries`: passed. Fixtures cover provider and transport imports, indirect business helpers, type imports, and dynamic/require attempts.
- `vp check --no-fmt`: passed.
- `PORT=58732 node --experimental-strip-types apps/api/src/runtime/node.ts`, then `curl -fsS -i http://127.0.0.1:58732/health`: 200 with JSON, request ID and no-store. Listener stopped afterward.

Use the explicit `run` scripts: `vp test` selects the Vite+ built-in and can load a second Vitest context. Test-only error routes exist solely in the fixtures. Workerd tests use Miniflare, not hosted Workers. Auth, database composition, production middleware, actual product routes, WebSocket upgrades and full Go wire parity remain future work. The foundation supplies JSON 404/405 responses; Go's default mux emits plain-text responses, so callers must decide parity before migration activation. No hosted or production validation.
