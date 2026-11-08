# Native backend release

The backend source is Hono/TypeScript with embedded Better Auth, Drizzle/PostgreSQL, a trusted TypeScript runner and independent verifier. Cloudflare Workers is the native cloud target; a portable Node API image remains available.

`.github/workflows/hono-stage-deploy.yaml` owns isolated staging provisioning and hosted validation. It reuses the existing Neon project, a separate stage branch/database, private Terraform state, purpose-scoped service credentials and pinned case authority. Staging currently uses no Cloudflare Access. Frontend publication remains independent in `.github/workflows/frontend.yaml`.

Use `.github/workflows/hono-production.yaml` with the current `main` revision to inspect the active deployment, release the API, or coordinate a private Worker rollout. Runtime database roles remain separate from migration authority. See [database operations](database.md) and [native deployment](../../deploy/README.md).

Provision with Terraform and deploy through GitHub Actions. Merging into `main` and changing production traffic require explicit user authorization. A frontend deployment, local tests or a green CI run does not establish that the backend was promoted.
