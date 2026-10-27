# Account loading

Ledger: [#218](https://github.com/ethan-ngai/quorem/issues/218).

The browser starts the cookie-authenticated profile read with the session request. It admits that profile only when its auth subject matches the bearer accepted by the API and the current bearer; a mismatch triggers a fresh read. JWT name, photo and color are display hints after server validation. Tokens and capabilities are never persisted.

A tab-local avatar hint can appear, without controls, while the session is checked. Hints expire after 24 hours; sign-in and sign-out invalidate other tabs' hints when browser storage is available. A session resolved as another account replaces the hint. External account changes or unavailable storage can leave a stale hint visible until verification completes.

The API overlaps a read-only product identity lookup with auth-service session verification. It performs binding creation and profile projection only after verification. Revocation, disabled-account and capability checks remain authoritative. Production latency and cold-start behavior require hosted measurement.
