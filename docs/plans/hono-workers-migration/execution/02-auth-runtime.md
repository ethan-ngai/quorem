# 02 Auth runtime spike (#337, parent #335)

Executed locally 2026-10-30: Node 24.21.0, Better Auth and passkey 1.7.7, Drizzle 0.45.4, pg 8.16.3, Wrangler 4.156.0/workerd 1.20261023.1 with `nodejs_compat`, PostgreSQL 17. The probe uses fixture-only credentials, a separate container, and a fresh `quorem_auth` schema recreated from auth migrations. It never touches the development database.

## Reproduce

From the repository root, with port 55432 and 18878 free:

```sh
docker run -d --rm --name quorem-hono-auth-spike -e POSTGRES_PASSWORD=fixture-only -e POSTGRES_DB=quorem_hono_auth_runtime_test -p 127.0.0.1:55432:5432 postgres:17
vp -C tools/migration-auth install -- --ignore-workspace --allow-build=esbuild --allow-build=sharp --allow-build=workerd
vp -C tools/migration-auth run probe
docker stop quorem-hono-auth-spike
```

The probe drops and recreates `quorem_auth` at its hard-coded disposable address. Never forward that port to a shared database. The worker opens and closes a PostgreSQL client per request; this tests direct local connections, not Hyperdrive.

## Results

- PASS: Node-generated default Better Auth password hash verifies in workerd; workerd-generated hash verifies in Node. A workerd-created credential also signs in via Node. Single sequential verify plus hash took 63 ms; four concurrent requests took 239 ms wall, with reported per-request execution times 59, 59, 58 and 57 ms. This small local sample is not a CPU, memory or hosted capacity budget.
- PASS: real Worker handlers against the migrated PostgreSQL schema: signup, unverified-email sign-in rejection, verified sign-in, session read, sign-out revocation. Node reads the Worker-issued session and the Worker reads a Node-issued session with the same fixture secret and origin.
- PASS: an assurance row attached to a real session persists and cascades on sign-out. This tests storage only, not the passkey verification hook or strong-auth policy.
- PASS: passkey registration options for an authenticated session; real JWT issuance and Ed25519 verification against the real JWKS endpoint. Expiring the stored key triggers a new key and both appear during the grace period; the new token verifies.
- PASS: social provider factories for Google, Apple, GitHub and Cognito load in workerd. This does not exercise their flows.

Use the pinned package export `better-auth/adapters/drizzle` and `drizzleAdapter(db, { provider: 'pg', schema })`; the 1.7.7 package declares this export and depends on the matching adapter. Drizzle 0.45.4 satisfies its peer range. The probe explicitly defines `pgSchema('quorem_auth')`, including mixed-case columns, and does not rely on `search_path`. Definitions are a probe, not canonical schema parity; constraints, additional application-owned columns and all queries require independent verification. See [official adapter installation](https://better-auth.com/docs/installation).

## Open gates

- No historic production hash corpus or preexisting production session was used. No sustained concurrency/abuse or resource benchmark. Cookie tests use HTTP localhost, not production HTTPS/domain attributes. No old binary deployment tested.
- No WebAuthn registration/assertion verification, user-verification assurance timestamp, passkey deletion, social linking/email proof or Cognito OAuth round trip. No hosted Hyperdrive, transport failure, key rotation concurrency or stale-key grace expiration test. These remain migration blockers, not passed by import/options tests.
- `sharp` in `profile.ts` is a native image decoder and must stay behind an `ImageProcessor` port; SMTP stays in the Node adapter. A private isolated Node service retaining sharp is the fallback. Cloudflare's [Images binding](https://developers.cloudflare.com/images/optimization/binding/) accepts bytes and transforms images, but parity for format detection, single-frame/pixel limits, metadata stripping and budgets is unproved; no Worker-safe WASM implementation was validated.
- The existing Cloudflare mail adapter uses HTTPS; [Cloudflare Email Service](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) supports a Worker binding and REST API. Account onboarding, verified sender, arbitrary-recipient capability and actual delivery were not checked; no mail was sent. Fail configuration when the selected capability is unavailable. Do not include SMTP/native addon imports in the Worker bundle.
