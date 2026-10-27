# Production deployment

Ledger: [#179](https://github.com/ethan-ngai/quorem/issues/179).

`Deploy production` runs from `main`. GitHub Actions builds Astro and React into one static artifact, packages Go/Node services, the judge controller and isolated language images, then applies Terraform. Separate build/deployment jobs retain the verified registry images when infrastructure needs a retry. Unchanged image inputs may reuse a prior run's successful checks after checking its job results and exact source diff. Cloudflare Workers route one configured origin to separate application and judge containers; each case runs in a disposable container. PostgreSQL and the auth schema live in Neon. R2 stores locked Terraform state. Application data never relies on container disk.

Terraform owns the state bucket, Neon project, Worker/version/deployment, Containers applications and rollout, and custom domain. The Containers applications and application rollout use `Mastercard/restapi` because Cloudflare's native provider lacks those resources. A Terraform-owned upload step supplies named-image metadata missing from the Worker provider. Immutable rollout history remains on Cloudflare when Terraform replaces its rollout state entry. Wrangler pushes images but does not provision applications.

App pools and instances include a fingerprint of the runtime bindings in their names. New requests check the coordinator and selected instance revision before dispatch; a stale version is rejected before a command can execute. Prior revisions can serve existing connections while they drain. The application limit reserves space for two full generations; further overlapping revisions may return capacity errors until older connections close. Image rollouts and Cloudflare object resets can still disconnect sockets. The revision checks add two internal requests per ingress request; hosted latency and capacity must be measured.

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

The workflow tests against a separate disposable PostgreSQL database and runs the direct-case launcher and framed runner transport against disposable privileged Linux containers. Before production deployment, the actual hosted case service must pass behavioral isolation, resource-limit, teardown and PostgreSQL probes. Judge startup checks authenticated case-service connectivity without starting test containers. Each case starts a fresh container without Internet access; its launcher creates isolated PID, network, mount and cgroup namespaces, drops privileges and capabilities, installs a seccomp filter, and fails closed if isolation cannot be established. The controller retains expected answers and credentials outside the case container. Hosted behavior and latency require separate validation.

After deployment, verify homepage, application deep links, public catalog, auth capabilities, admin login and private question authorization at the actual production origin. Terraform validation and local Docker tests alone do not establish cloud readiness.

Production Actions defaults to password authentication and Purelymail when SMTP credentials are present. To select another supported adapter, set `AUTH_EMAIL_DRIVER` and its adapter-specific variables and secrets in the production Actions environment; see [auth configuration](../../apps/auth/.env.example). Set `AUTH_MODE=cognito` and the Cognito configuration there to select Cognito. The deployment validates selected settings, but live provider acceptance remains a separate check. Secrets stay in Actions secrets and runtime bindings, not public configuration.
