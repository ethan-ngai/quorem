# Account loading

Ledger: [#218](https://github.com/ethan-ngai/quorem/issues/218).

The browser reads the account session and profile using the same-origin HttpOnly cookie. Product identity and avatar data come from the authorized session response. A profile with a different account subject triggers a fresh read.

A tab-local avatar hint can appear, without controls, while the session is checked. Hints expire after 24 hours; sign-in and sign-out invalidate other tabs' hints when browser storage is available. A session resolved as another account replaces the hint. External account changes or unavailable storage can leave a stale hint visible until verification completes.

The API overlaps a read-only product identity lookup with auth-service session verification. It performs binding creation and profile projection only after verification. Revocation, disabled-account and capability checks remain authoritative. Production latency and cold-start behavior require hosted measurement.
