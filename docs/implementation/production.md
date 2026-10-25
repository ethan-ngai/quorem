# Production deployment

Ledger: [#179](https://github.com/ethan-ngai/quorem/issues/179).

`Deploy production` runs from `main`. GitHub Actions builds Astro and React into one static artifact, packages Go/Node services and isolated language images, then applies Terraform. Separate build/deployment jobs retain the verified registry image when infrastructure needs a retry. Unchanged application trees may reuse a prior run's successful checks after checking its job results and exact source diff; every image still repeats the nested isolation gate. Cloudflare Workers routes one exact configured origin to a container running Nginx, API, auth and judge. PostgreSQL and the auth schema live in Neon. R2 stores locked Terraform state. Application data never relies on container disk.

Terraform owns the state bucket, Neon project, Worker/version/deployment, Containers application and rollout, and custom domain. The Containers application/rollout use `Mastercard/restapi` because Cloudflare's native provider lacks those resources. Immutable rollout history remains on Cloudflare when Terraform replaces its rollout state entry. Wrangler only pushes the built image; it does not provision the application.

## Configuration

Repository secrets:

- `CLOUDFLARE_API_TOKEN`: Workers scripts/tail, Containers and R2 provisioning permissions for the deployment account; routes access for the target zone.
- `NEON_API_KEY`: key permitted to create/manage the production project.
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: object read/write for the state bucket.
- `BETTER_AUTH_SECRET`, `AUTH_INTERNAL_SECRET`: independent random secrets, at least 32 characters.
- `QUOREM_INVITE_KEY`: base64url-encoded 32 random bytes; stable across releases.
- `AUTH_BOOTSTRAP_PASSWORD`: initial operator password, at least 20 characters and one punctuation character.
- `PRIVATE_QUESTION_JSON`: private authoring content, including hidden cases; never commit it or include it in container images.

Repository variables: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `PRODUCTION_DOMAIN`, `TF_STATE_BUCKET`. IDs also accept repository secrets for compatibility. `NEON_PROJECT_ID`, `NEON_PROJECT_NAME`, `NEON_REGION` select an existing project for Terraform import; its branch/database/compute settings remain unchanged. A project-scoped key suffices for this path. Optional `DEPLOY_VALIDATED_RUN` selects prior test evidence. Workers Paid and R2 must be active. `scripts/terraform-state.py` bootstraps a missing bucket through Terraform, migrates its bootstrap state into R2, and initializes separate application/database state keys. Bucket and database destruction are protected by Terraform lifecycle rules. State contains credentials; keep the bucket private.

All application URLs derive from the configured origin. Marketing uses `QUOREM_SITE_URL`; browser API/auth requests remain origin-relative. The optional hosted language gateway stays disabled. Nginx serves `/` from Astro, application routes from `app.html`, and proxies only public API/auth routes; `/internal/*` stays private.

## Initial account and questions

The explicit auth bootstrap command creates a verified `ethanmngai@gmail.com` operator with username `ethanmngai`, an immutable product identity binding, admin role and internal access. The bootstrap ledger prevents later releases from resetting passwords/profiles or restoring revoked privileges. Local Alice/Bob seeding remains loopback-only. Product provisioning installs six public fixture questions plus Balance Ledger, then publishes the supplied private question under the operator's ownership. Imports resume recorded drafts on retries.

Until SMTP is ready, production sets `AUTH_MODE=password`, `AUTH_PASSWORD_PRODUCTION=true`, `AUTH_LOGIN_ONLY=true`. Only verified existing accounts can sign in. Registration, recovery email and social providers remain unavailable. To enable Purelymail later, configure the existing authenticated TLS SMTP adapter and remove `AUTH_LOGIN_ONLY`; never bypass email verification.

## Runtime validation

The workflow tests against a separate disposable PostgreSQL database and runs the full Linux container with `--verify-only`. Every production container repeats the engine-owned sandbox preflight before starting API/auth/runner: network/filesystem/process isolation, kernel memory/PID/CPU/swap limits, actual memory/time/output failures and teardown. A failed gate stops startup before any job claims. The inner Docker daemon uses Cloudflare's documented networking/cgroup flags; contestant containers retain `--network none` and all existing restrictions.

After deployment, verify homepage, application deep links, public catalog, auth capabilities, admin login and private question authorization at the actual production origin. Terraform validation and local Docker tests alone do not establish cloud readiness.
