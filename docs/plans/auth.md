# Identity — Better Auth + Cognito

Confirmed: email/password plus social sign-in, Better Auth + Amazon Cognito. Authorized 2026-10-12: replace local identity controls with real credential sessions; seed local username/password accounts for preview.

## Ownership and topology

`apps/auth` is a small TypeScript service running Better Auth; product API and judge stay Go. Cognito owns deployed email/password signup, verification, password reset, and federated sign-in. Better Auth uses its Cognito provider, stores app sessions/accounts in a separate PostgreSQL auth schema, and issues short-lived application JWTs for Go/language/realtime authorization. Local loopback preview exclusively uses Better Auth's password store with seeded usernames; the two credential modes are mutually exclusive. Local seed verification substitutes for email delivery only in this guarded preview.

Start social sign-in with Google through Cognito. GitHub is a potential later Better Auth direct provider, not assumed to be a native Cognito federation provider. Quorem internal user IDs map immutable issuer/subject/account bindings, never email as the authorization key. Linking requires reauthentication and verified identity; equal emails alone never merge accounts. Anonymous users may inspect public problems; judging, drafts, and matches require an identity.

Use one workspace origin, routing `/api/auth/*` to auth and `/v1/*` to Go. Prefer Cognito managed sign-in for the credential flows first; custom embedded credential UI is outside the editor-first milestone. Same-origin app cookies remain secure/HTTP-only, with origin/CSRF controls and exact redirect allowlists. OAuth code flow uses state/PKCE where supported; secrets stay server-side. Restrict callback URLs by environment.

## Application verification

Better Auth session cookie is not a Go API bearer token. Use its JWT plugin's token/JWKS endpoints for external services; API verifies configured issuer, audience, algorithm, expiry and subject, with bounded JWKS cache refresh/rotation behavior. Keep JWTs in browser memory. Five-minute access lifetime; refresh requires live session. Subject/session disable checks protect sensitive actions; regular logout revocation bound documented in operating defaults.

Go IdentityVerifier returns internal subject/session context, independent of Cognito/Better Auth claim names. Local DevIdentityVerifier is explicitly configured, loopback-only and rejected by production startup/config checks. Clients cannot self-select another user's ID in production. AppSync Lambda authorization validates the application identity and participant subscription scope; server publishes via IAM. Authorized channel templates must not grant wildcard access to all matches. Language-session gateway and private local WebSockets use the same ownership rules.

## Acceptance

Cognito verified-email state maps from trusted provider data to app identity; JWT includes server-derived verified-email/session identity. Go rejects unverified/disabled subjects for drafts/execution/matches and checks server-side disable state for privileged commands. Missing or forged browser verification claims never grant access.

- Signup requires email verification before judging/matches; reset works without account enumeration; login errors are safe.
- Unverified account, missing verification claim, forged browser flags and disabled subject rejected across Go/language/realtime entrypoints.
- Google and password identities create stable internal users; explicit linking/duplicate-email refusal tested.
- Session expiry/logout, disable, JWT expiry/wrong issuer/audience, JWKS rotation and auth outage tested.
- Two owners cannot read drafts/submissions, subscribe to another match, or share language-service symbols.
- Development identities rejected in production; auth data/migrations remain service-owned.
- Mock OAuth/identity contract tests run locally; actual Cognito verification/reset/social/refresh flows are cloud acceptance, not needed for solo development.

## Verified sources

[Better Auth Cognito provider](https://better-auth.com/docs/authentication/cognito) documents code-flow provider integration and stored provider tokens. [JWT plugin](https://better-auth.com/docs/plugins/jwt) separates application JWTs from session cookies and supplies JWKS verification. [Cognito identity providers](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-identity-provider.html) documents supported federation. Pin/recheck library versions at implementation.
