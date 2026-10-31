# Native deployment

The Hono API runs in Cloudflare Workers or the portable Node image `deploy/hono/Dockerfile.api`. Trusted runner and verifier images use the separate targets in `deploy/hono/Dockerfile.runner`; untrusted cases remain isolated in the existing case sandbox images. Their credentials and signing keys stay outside case containers.

`.github/workflows/hono-stage-deploy.yaml` provisions and validates an isolated stage. It is not a production release workflow. Production cutover requires separate authorization and verification. Frontend publication remains owned by `.github/workflows/frontend.yaml`.

Local release checks use `node scripts/hono-workload-validation.mjs` and `node scripts/hono-container-validation.mjs` with Docker and the documented fixture images. They do not deploy cloud resources or establish hosted performance.
