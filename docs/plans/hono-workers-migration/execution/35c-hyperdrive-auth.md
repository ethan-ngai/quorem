# 35c Staged Hyperdrive and auth preflight

Issue #422. Terraform creates a stage-only Hyperdrive binding from the explicit PostgreSQL origin and connection budget, with caching disabled and encrypted origin connections. The 5–100 connection budget must fit the provider plan and database capacity. TLS `require` encrypts transport but does not verify the origin hostname; authenticate and validate the origin separately. [Cloudflare Hyperdrive Terraform reference](https://developers.cloudflare.com/api/terraform/resources/hyperdrive/)

The origin password is sensitive but may appear in Terraform state and saved plans. Use encrypted remote state and backups, restricted access and reviewed retention; never print state or retain unencrypted plans.

Run `node scripts/hono-stage-preflight.mjs <public-input.json> <terraform-outputs.json>` with selected secrets in the process environment. It validates bindings, scoped bearer separation and the real Worker auth constructor without network calls. Set `VERIFICATION_ACCESS_MODE=none` for bearer-only verifier transport. Worker auth validates its selected identity, mail and media settings; SMTP is not a Worker mail adapter. Explicit password login-only mode supports existing seeded accounts without enabling registration mail.

Fixture-only Terraform and constructor tests do not prove hosted database identity, email delivery or private service reachability. Those remain activation gates.
