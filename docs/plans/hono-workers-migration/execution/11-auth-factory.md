# 11a Auth factory and runtime — partial (#359)

The Better Auth factory receives configuration, adapter, semantic auth repository operations, social proof flow and optional account-mail sender. Node composition remains in `node-auth.ts`; Worker code does not import the Node pool, infrastructure, sharp or SMTP. The pinned official Drizzle adapter is constructed per operation on a core-owned scope, with a real transaction only for its transaction callback. Auth profile, assurance, social-proof and persistent rate-limit queries use qualified `quorem_auth` tables through the semantic repository. Better Auth's per-instance memory limiter is replaced by atomic PostgreSQL limits so request-local Worker factories cannot reset it. JWT profile revision fails closed beyond JavaScript's safe integer range.

`createAuthApp` provides native Hono request/response routing, preserving multiple cookies, registration/profile injection and hosted sign-in. It does not mount `/internal/session`; `AuthRepository.sessionAuthority` is the private same-process/service-binding seam. The existing Node listener retains its authenticated internal endpoint and calls that repository. `native-worker-fixture.ts` and its Wrangler configuration are test-only; the fixture exposes seed and authority routes and must never be deployed.

The backend-only `ConnectionScope.withDatabase` uses the same connection lifetime, abort, error and release owner as transactions. It guards escaped handles/lazy builders and disallows raw client/session access, concurrent scope operations and detached queries; this is a lifecycle aid for trusted adapters, not a general sandbox. The wrapper classifies an uncertain Drizzle transaction commit as unknown; its own lost-acknowledgment path still needs a dedicated fault-injection test. It is not a request-wide SQL transaction.

## Validation

Disposable PostgreSQL 17 on 55438, migrations from existing auth history, Better Auth/passkey 1.7.7, Drizzle 0.45.4 and Wrangler 4.156.0/workerd 1.20261023.1. Node auth suite: 94 passed, 1 Mailpit-dependent test skipped. Native workerd with direct local Hyperdrive binding: real signup and sign-in, verified-email enforcement, Worker-created password hash verified by Node, Node-created credential accepted by Worker, both directions of session-cookie reads, private authority lookup and revocation, profile-image policy, unsafe revision rejection, repeated-request rate limiting and public `/internal` 404. Node Hono tests check multiple Set-Cookie values. `apps/auth` and database typechecks passed; direct Node 24 import of the factory passed. Database core: 12 disposable PostgreSQL tests and workerd primitive checks passed, including escaped/lazy handle and detached-query cleanup.

Reproduce only with isolated fixtures; the check script deletes rate-limit rows in the named test database:

```sh
docker run -d --rm --name quorem-hono-auth-native-test -e POSTGRES_PASSWORD=fixture-only -e POSTGRES_DB=quorem_hono_auth_native_test -p 127.0.0.1:55438:5432 postgres:17
AUTH_TEST_DATABASE_URL='postgres://postgres:fixture-only@127.0.0.1:55438/quorem_hono_auth_native_test' vp -C apps/auth test --run
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB='postgres://postgres:fixture-only@127.0.0.1:55438/quorem_hono_auth_native_test' vp -C apps/api exec wrangler dev --local --config ../../apps/auth/wrangler.native-test.jsonc --ip 127.0.0.1 --port 58738
```

In another shell: `vp -C apps/auth exec node src/native-worker-check.mjs`. Stop Wrangler and the container after testing. Database primitive tests use their own separately named disposable database on port 55436 as documented in packet 06.

## Passkey and profile follow-up

`vp -C apps/auth exec node src/native-passkey-check.mjs` exercised a locally generated Ed25519 virtual authenticator against the native workerd factory and disposable PostgreSQL. Real WebAuthn registration and signed assertions passed across Worker and Node sessions. A verified assertion populated strong assurance; an assertion without user verification created a session without strong assurance. Reused challenge, invalid signature, repeated counter, out-of-range stored counter and assertions after passkey deletion failed. The maximum uint32 counter succeeded once and could not be replayed. This is a protocol fixture, not a physical authenticator or hosted/browser end-to-end test; concurrent assertion races remain unverified.

`createProfileHandler` keeps mutation windows and the processing counter in its closure. Node constructs it once; a Worker that constructs it per request would reset these controls and cannot enforce distributed limits. `ProfileMutationBudget` is a semantic interface only, not a wired implementation. Packet 12 must implement atomic shared per-user window admission and bounded global processing leases, preserve the 10-per-minute, four-in-flight and bounded-subject policies, make release idempotent, and fail closed on storage failure. Lease expiry must exceed the maximum allowed image operation lifetime and stalled work must be canceled before capacity is reclaimed. No Worker profile upload is enabled by this slice.

## Remaining gates

Packet 11 is **not complete**. Registration, account mail and delivery adapters still use the existing Node pool and delivery-in-transaction implementation. A separate dependent slice owns encrypted durable mail intents, registration challenge atomicity, ambiguous-delivery fencing, provider failure semantics and migration 005. No real mail/cloud provider was used. Physical/browser WebAuthn and concurrent passkey assertions, production social/Cognito round trips, hosted Hyperdrive behavior, concurrent auth operations, key rotation under load and hosted identity/session authority remain unverified. Better Auth warned that the local fixture has no trusted client IP and falls back to a shared per-path bucket; production must explicitly validate trusted proxy/IP configuration before use. Root lockfile/importer integration and production Worker composition remain with the orchestrator.
