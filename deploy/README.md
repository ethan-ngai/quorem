# Native deployment

The Hono API runs in Cloudflare Workers or the portable Node image `deploy/hono/Dockerfile.api`. Trusted runner and verifier images use the separate targets in `deploy/hono/Dockerfile.runner`; untrusted cases remain isolated in the existing case sandbox images. Their credentials and signing keys stay outside case containers.

`.github/workflows/hono-stage-deploy.yaml` provisions and validates an isolated stage. `.github/workflows/hono-production.yaml` owns the authorized production cutover: preserve existing configuration, snapshot the existing Neon database, fence the Go runtime, migrate retained data, then activate native services and the API. Dispatch with an exact `release_sha`; `resume_prepared` resumes an already fenced setup. Frontend publication remains owned by `.github/workflows/frontend.yaml`.

Local release checks use `node scripts/hono-workload-validation.mjs` and `node scripts/hono-container-validation.mjs` with Docker and the documented fixture images. They do not deploy cloud resources or establish hosted performance.
