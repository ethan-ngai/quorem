# 37h: OAuth fixture peers

Issue #425. The social OAuth fixture now passes distinct synthetic peers through `authPeerRequest`, the same trusted boundary used by the runtime. Its previous `X-Forwarded-For` header was intentionally ignored, causing separate OAuth steps to share the fallback rate bucket. Production rate limits and forwarded-header trust remain unchanged.

Validated with isolated PostgreSQL databases `quorem_hono_auth_native_test`, `quorem_hono_profile_test`, and `quorem_hono_mail_test`, plus a separate local Mailpit. Auth typecheck and scoped lint pass; the full Vitest auth suite passed 126/126 and the separate mail-intent suite passed 22/22 with real database connections. The auth suite includes account linking, password and shared-rate-limit regressions. No hosted OAuth or mail calls were made.
