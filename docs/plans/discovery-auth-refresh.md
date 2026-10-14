# Discovery and sign-in refresh

Issues #54, #55, #56. Depends on the integrated development preview and shared UI refinements (#53).

## Confirmed

- Server-side practice search/filter/sort, represented by URL query parameters.
- Redesign the practice gallery using existing workspace typography and theme.
- Guests see Sign in instead of an initials avatar.
- Redesign sign-in in the current theme. Desktop shows the marketing problem-card stack on the left over a restrained animated deformed grid; small screens omit it.
- Implement passkeys and social sign-in. Google/Apple credentials are unavailable for this local milestone.
- Add a Sign in/Create account mode switch and real local registration with email verification; use a local inbox fixture. Place Back at the top left, replacing Browse problems.

## Defaults

- Query `q`, `difficulty`, `topic`, `sort`, `order`, `page`, `limit`; bound page size and validate enum values. Search/filter in persistence; use stable ordering and independent filter metadata.
- Sign-in form has labeled credential fields and password visibility. Provider controls reflect server capabilities; unsupported reset/SSO flows are omitted. Account creation remains unverified until the email verification link is completed.
- Add passkey enrollment and management to authenticated account settings. Existing credential sessions and explicit account linking boundaries remain intact.
- Desktop sign-in uses a 48/52 showcase/form split, a 400px form and hairline division. Omit showcase below 900px. Canvas vertex displacement stays subtle; reduced motion and hidden/offscreen states suspend animation.

## Evidence gates

- Query parsing, SQL parameterization, stable pagination and URL back/forward tests; no client-side substitute for server filtering.
- Credential regression, capability/configuration checks, passkey challenge/origin/session tests. Browser authenticator ceremony remains explicit if this environment cannot automate it.
- Social provider secrets stay server-side; real external OAuth requires configured providers and cannot be claimed verified without credentials.
- Live Vite preview in both themes and narrow/desktop layouts; no overflow, inaccessible fields or nonfunctional flow controls.
