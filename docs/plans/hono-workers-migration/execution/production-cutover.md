# Production cutover — 2026-11-01

Umbrella: [#335](https://github.com/ethan-ngai/quorem/issues/335).

User explicitly authorized production/main promotion, direct deployment and skipping further tests.

- Backend: [41340327464](https://github.com/ethan-ngai/quorem/actions/runs/41340327464), release `a04c73d03498499d520198d40db6140df39da3bb`, native Hono Worker at `https://quorem.app`. Health and auth configuration returned 200; activation recorded in Terraform state.
- Frontend: [41336244450](https://github.com/ethan-ngai/quorem/actions/runs/41336244450), source `4db7835070d3d271d411298ead44ba5e745ff48d`. Later backend/operator fixes do not change frontend sources. Frontend tests explicitly skipped.
- Existing Neon project/database retained. Pre-write snapshot branch: `br-plain-morning-b7qkwzce`. No new Neon project or Cloudflare Access resources.
- Product migrations 007–063 and auth migrations 001–006 have checksummed ledgers. The name-only production baseline was verified against deployed Go provenance, run [41134339533](https://github.com/ethan-ngai/quorem/actions/runs/41134339533), source `5e857358689693fd0150820103dff1a9ec6f6cb2`.
- Canonical normalization completed: 19 problem versions, five interview input fixtures, seven private-result records and 52 result records. Historical snapshots retain all captured cases even when suite counts differ from metadata; immutable source snapshots remain unchanged.
- Existing auth/internal secrets, password/social/passkey configuration and SMTP delivery retained. The invitation AES key retains its exact bytes, converted from Go's base64url configuration to Hono's hex configuration. Production contained zero referenced profile objects requiring copying.
- Native restricted database role, Hyperdrive, execution/dead-letter queues, R2 profile bucket and private runner/verifier/case/image/mail services provisioned through Terraform. Hyperdrive query caching remains disabled. Native queue consumer attached; old Go Worker, four container applications and queue consumer retired.
- Production uses separate state keys: `hono-production`, `hono-production-api`, `hono-production-services`. Secrets remain in protected state/provider bindings. Activation retries verify the audited migration receipt and exact current migration checksums before reusing completed data normalization.

No production submission, email, browser-flow, capacity or restore rehearsal was run. Earlier local/staging evidence remains separately documented in [staging bring-up](staging-bringup.md). This cutover establishes deployment and basic readiness, not broader production validation.
