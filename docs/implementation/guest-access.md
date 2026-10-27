# Guest access and operator privileges

Ledger: [#91](https://github.com/ethan-ngai/quorem/issues/91). [Plan and gates](../plans/guest-access-and-entitlements.md).

Local stack: `make dev`; open `WEB_ORIGIN` (default `http://localhost:5173`). Sign in as seeded **Alice** using the existing local fixture password: admin authoring + internal benefits, including guest hosting. **Bob** remains a free-account comparison. Credentials are generated in ignored `.local/auth-preview.json`; do not publish them. No production sample account exists.

On Create match or an open hosted lobby, enable the **Allow guests** icon (off by default). Free regular hosting is unchanged. Invitees see the lobby behind a dialog: signed-in people accept explicitly; anonymous people sign in or enter a guest name. Regular invitations offer sign-in only. Guest practice Run/Submit still requires an account. Guests are visibly unverified and cannot host/administer/use hosted intelligence. Browser-local Python/TypeScript intelligence is available to everyone. Guest navigation always offers Sign in. Match completion or forfeiture revokes the guest credential and clears the cookie; an in-memory result summary remains visible until navigation. Anonymous draft editing remains available.

Match and interview guests share token generation and validation, name validation, guest-user creation, cookie construction, and sponsor concurrency accounting. Credentials remain separately scoped to their room type; admission, membership, expiry and rollout switches retain their room-specific rules.

Host controls: the lock icon beside Leave opens/closes admission without resetting readiness; the replace-link icon rotates invitations; remove a guest before start. The animated guest icon sits immediately left of the lock and is hidden from ineligible accounts. Guest execution currently has no cumulative room or monthly allowance; metering remains, along with participant/global rate limits and sponsor concurrency protection. Legacy job/time overrides are inactive. Rotating affects future admission only. Existing open-link guests cannot be securely identified after cookie deletion; use admission locking/rotation for stronger control. This is an eight-seat pilot, not classroom capacity certification.

## Private operator access

Use independently provisioned operator database credentials in `QUOREM_OPERATOR_DATABASE_URL`. Never expose them to the browser/auth service or configure a public bootstrap endpoint. Production database grants must separately restrict runtime writes to access tables; the CLI environment-variable name alone does not enforce database isolation.

Inspect exact existing product user ID and immutable issuer/subject before granting. Do not target by display name or automatically link email identities.

```sh
go run ./apps/api/cmd/access inspect --user '<product-user-id>'
go run ./apps/api/cmd/access grant --user '<product-user-id>' --scope admin --actor '<operator>' --reason 'Question authoring' --ref 'owner' --op-id '<unique-admin-operation>' --dry-run
go run ./apps/api/cmd/access grant --user '<product-user-id>' --scope admin --actor '<operator>' --reason 'Question authoring' --ref 'owner' --op-id '<unique-admin-operation>'
go run ./apps/api/cmd/access grant --user '<product-user-id>' --scope internal --actor '<operator>' --reason 'Internal benefits' --ref 'owner' --op-id '<unique-benefits-operation>'
go run ./apps/api/cmd/access quota --user '<product-user-id>' --resource guest_concurrency --value 3 --actor '<operator>' --reason 'Measured pilot capacity' --op-id '<unique-quota-operation>'
```

Use `revoke` with the same scope/source/ref and a new operation ID. Optional `--expires '<RFC3339>'` applies to feature grants; admin grants require explicit revocation. `--source subscription` cannot grant admin. Cancellation only revokes the specified source/reference; independent internal grants remain. Reuse an operation ID only for an exact retry. Publishing requires signing in again with a user-verified passkey; step-up expires after ten minutes. Register/test backup authenticators before relying on this in production. Internal benefits never remove execution/platform ceilings.

## Rollout and rollback

The Cloudflare production configuration enables `GUEST_CREATION_ENABLED`, `GUEST_ADMISSION_ENABLED`, and `GUEST_EXECUTION_ENABLED` for the bounded match pilot; host eligibility still requires an active `matches.host_guests` or `internal` grant. The API defaults these flags off outside local development when not configured. Terraform variables `guest_creation_enabled`, `guest_admission_enabled`, and `guest_execution_enabled` independently pause the operations. Stop new admissions first, then drain jobs; execution pause blocks new runs without hiding existing results. Flags are read on API startup; provision/deploy via Terraform/GitHub Actions only.

PostgreSQL request limits use connection-peer addresses, deliberately ignoring untrusted proxy headers. A reverse proxy may share one bucket across clients. Tune only after measuring; do not use restrictive per-campus-IP limits as primary accounting.

Source/results/custom-case scrubbing runs at startup and hourly after seven days. Expired guest names are anonymized. Token expiry is enforced on reads, writes and realtime delivery. Accounting/audit retention and backup deletion still require the operational gates in the plan; do not promise classroom retention guarantees yet.

## Verification

Use a separate disposable database for `QUOREM_TEST_DATABASE_URL`; integration tests truncate it. Run `go test ./apps/api/... ./apps/language/internal/gateway`, `vp test apps/web/src apps/auth/src`, `vp -C apps/language run test`, `vp run contracts:check`, `vp check`. Validate live Vite/HMR guest join, refresh, real judge execution and hardware passkey publishing before enabling a production pilot.
