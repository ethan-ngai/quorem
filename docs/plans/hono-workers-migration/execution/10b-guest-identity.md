# 10b: Scoped guest identity

Issue #366. Unmounted identity slice; no aggregate join/remove/rotate commands or migration.

`GuestPrincipal` distinguishes match and interview scopes and cannot be admin or verified. `authenticateGuestRequest(headers, kind, managed, guests, { method, allowedOrigins })` gives bearer and WebSocket bearer credentials precedence, rejects malformed/duplicate credentials, enforces guest mutation origins and uses SHA-256 of the canonical 32-byte token. Guest cookies are scope-specific. `sessionId` is the internal credential hash; never serialize it as a public session field.

`guestRepository(scope)` rechecks guest/host enabled state, membership, revocation and database-clock expiry on every lookup; match lookup also enforces and updates the two-hour inactivity window. `lookupGuestInTransaction` lets aggregate owners revalidate within their own transaction. `revokeGuestInTransaction` requires the caller to authorize and lock its aggregate first. `endMatch` revokes only finished/cancelled or forfeited sessions. `readMatchGuestSession` supports the shared `/v1/session` owner: an `ended` result requires clearing the guest cookie and responding 401. A principal is a point-in-time identity, not a revocation cache; WebSocket and aggregate operations must recheck live authority.

`guestRoutes` supplies unmounted bootstrap/end endpoints using shared app error/no-store middleware. Its `trustedPeer` callback takes no request or headers: the runtime must inject actual trusted transport metadata per request, never forwarded headers. `allowPublicGuestRequest` and `publicGuestBudget` provide bounded peer keys, a common database-clock minute, atomic 6,000 global/1,200 peer limits and fail-closed errors. Call the same admission primitive for public invite endpoints when their aggregate routes land. A window rollover during accounting rolls back and denies the attempt.

## Local verification

The integration test drops `public` and applies product migrations. Use only the named disposable loopback database:

```sh
export GUEST_FIXTURE_PASSWORD="$(openssl rand -hex 16)"
docker run -d --name quorem-hono-guest-10b -e POSTGRES_PASSWORD="$GUEST_FIXTURE_PASSWORD" -e POSTGRES_DB=quorem_hono_guest_test -p 127.0.0.1:55448:5432 postgres:17
export QUOREM_GUEST_TEST_DATABASE_URL="postgresql://postgres:$GUEST_FIXTURE_PASSWORD@127.0.0.1:55448/quorem_hono_guest_test"
vp -C apps/api exec node --test src/adapters/postgres/identity/guest.integration.ts
vp -C apps/api exec vitest run --config src/adapters/postgres/identity/guest.vitest.config.ts
vp -C apps/api exec vitest run --config src/adapters/postgres/identity/guest.vitest.workers.config.ts
vp -C apps/api run typecheck
vp -C apps/api run check:boundaries
vp check --no-fmt
docker rm -f quorem-hono-guest-10b
```

Passed: seven PostgreSQL tests, six Node policy/transport tests and seven workerd tests including real request-scoped PostgreSQL; typecheck, boundary check and root lint passed. PostgreSQL tests cover host/user disablement, scope, removed/revoked membership, inactivity, lock-delayed expiry and revocation, active/forfeited/completed end, concurrent budget rollback and database outage. Workerd covers live revocation and shared budget against PostgreSQL.

No production mount, hosted test or WebSocket lifecycle integration is included. Interview guest join, removal, credential rotation and match seat transitions remain aggregate-owned packets; a future shared session transport must combine this slice with managed identity and preserve public DTOs. No forwarded peer metadata is trusted by this slice.
