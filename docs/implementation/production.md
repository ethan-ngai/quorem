# Native backend release

The backend source is Hono/TypeScript with embedded Better Auth, Drizzle/PostgreSQL, a trusted TypeScript runner and independent verifier. Cloudflare Workers is the native cloud target; a portable Node API image remains available.

`.github/workflows/hono-stage-deploy.yaml` owns isolated staging provisioning and hosted validation. It reuses the existing Neon project, a separate stage branch/database, private Terraform state, purpose-scoped service credentials and pinned case authority. Staging currently uses no Cloudflare Access. Frontend publication remains independent in `.github/workflows/frontend.yaml`.

The obsolete backend app-container release workflow has been retired from this source branch. This does not change already deployed production resources or imply a production release. Production remains at its last authorized deployment until an explicit native cutover is configured and approved. Do not run staging commands against production state or credentials.

Production preparation must preserve the public origin, auth issuer/cookie/key material and existing data. Existing name-only migration history requires the audited checksum baseline; retained normalized results, cases, checkpoints and profile objects have dedicated operator owners. Runtime database roles remain separate from migration authority. See [database operations](database.md), [API operations](../../apps/api/README.md) and [native deployment](../../deploy/README.md).

Provision with Terraform and deploy through GitHub Actions. Merging into `main` and changing production traffic require explicit user authorization. A frontend deployment, local tests or a green CI run does not establish that the backend was promoted.
