# Identity and auth migration

[Plan index](README.md)

Keep Better Auth and existing browser URLs/cookies/issuer/audience. Extract configuration and `createAuth(dependencies)` from import-time `process.env` and global pools. Mount `auth.handler(request)` through Hono; separate Worker deployment is optional composition, not a domain requirement. Preserve origin and cookie behavior regardless of service split. [Better Auth Hono integration](https://better-auth.com/docs/integrations/hono).

Required spike, using the repository's pinned Better Auth/plugins:

1. Existing password hashes verify in workerd; new passwords remain verifiable by rollback binaries. Benchmark hash CPU/memory under abuse and concurrent signup. No opportunistic hash-format change.
2. Sessions, JWKS/key rotation, JWT verification, verified-email requirements, strong-auth timestamps, passkeys, social linking/email handling and Cognito option work with request-scoped PostgreSQL through the supported Better Auth Drizzle adapter.
3. Preserve product/auth identity mapping and revocation. Use a `SessionAuthority` port; same-process calls and service bindings may implement it without exposing `/internal/session` publicly. Preserve verification errors versus service-unavailable errors and bounded socket credential caches.
4. `sharp` image processing becomes an `ImageProcessor` port with actual decoding, pixel/frame limits, metadata stripping, resize and encoded output. Prove a Worker-safe WASM implementation within budgets; if it fails, use a private isolated Node image service implementing the same port. Storage alone is not image validation. Local uses existing sharp behavior.
5. SMTP transport stays in the Node/local adapter. Worker mail uses a supported HTTPS/binding adapter; verify configured Cloudflare email availability or select another HTTPS provider. Missing selected capability fails configuration. No unconditional SMTP imports in Worker bundles.
6. R2 binding versus S3 APIs implement the existing storage semantics. Preserve compare-and-swap avatar updates, orphan cleanup, public URL ownership and privacy. Secrets/provider APIs never reach browsers.

`nodejs_compat` is a tested compatibility setting, not proof that native addons or every Node API works. [Runtime support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).

The auth schema remains separately qualified and owned even when its Drizzle definitions share the backend database package. Explicitly map Better Auth/plugin table and column names to existing records; preserve IDs, constraints and `quorem_auth` namespace. Avoid session-level `search_path` assumptions under Hyperdrive. Verify the adapter API compatible with pinned Better Auth versions rather than copying current-site imports blindly. [Official Drizzle adapter](https://better-auth.com/docs/adapters/drizzle).

Product access policies have one owner in `modules/access`. HTTP, sockets, authoring and candidate hydration call those policies; no separate guest/admin rules in each adapter. Session assurance and live revocation remain authoritative reads, never future KV candidates.
