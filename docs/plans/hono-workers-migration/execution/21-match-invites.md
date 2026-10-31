# 21 Match invitations and selection

Implemented unmounted `matchInvitationRoutes`, `matchInvitations` and `matchLanguageSelection`. Callers inject identity, the trusted transport peer, shared PostgreSQL guest budget, allowed origins and the guest-admission gate. Existing guest bootstrap owns the cookie. No production mount or search implementation is included.

The shared `matchCommandOwner` owns idempotency and encrypted create/rotation replay. Account join, rotation and language replays recheck current authority; rotated invitations cannot regain authority. Guest admission locks the credential, enabled host and match, then checks the live grant, capacity and lifetime join budget. Existing credentials remain scoped to their original match. Revocation removes the seat and session authority. Language changes retain the workspace for each language and reject pending executions.

`selectMatchCandidate(tx, owner, settings)` and `validateSelectedMatchProblem` are the transaction-bound selection owner used by match start. They use the catalog candidate reader, current sealed version and host visibility, pin the selected version and recheck its eligibility. Future retrieval must return authorized candidates through this owner; no semantic retrieval is implemented.

For account commands the order is idempotency advisory lock, actor row, enabled host row where needed, then match. Guest admission locks credential, existing guest owner when present, host and match. Opposing cross-host account joins can deadlock; PostgreSQL aborts one transaction rather than admitting without its locks. The existing bounded transaction reports that failure to the caller.

Local disposable PostgreSQL 55471, database `quorem_hono_invites_test`:

- `QUOREM_MATCH_INVITES_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55471/quorem_hono_invites_test?sslmode=disable node --experimental-strip-types --test src/adapters/postgres/matches/invitations/integration.ts` (from `apps/api`): 9 passed. Includes expiry during lock wait, real Node HTTP, credential precedence, trusted-peer budget, replay/rotation, cross-room guest scope, revocation, host disable/grant, concurrent join/start, pending execution and language reuse, and private/current selection.
- `QUOREM_MATCH_LIFECYCLE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55471/quorem_hono_invites_test?sslmode=disable vp exec vitest run --config src/adapters/postgres/matches/invitations/vitest.workers.config.ts` (from `apps/api`): 1 passed in workerd with real PostgreSQL and Durable Object; origin, duplicate cookie, concurrent guest admission and rotation.
- `vp run typecheck` and `vp run check:boundaries` (from `apps/api`): passed.

These tests do not establish hosted networking or production activation. Runtime composition, public invite event streaming and deployment remain with their owning packets. Removed the obsolete admission test `@ts-expect-error`, matching the existing integration correction `f7286969`.
