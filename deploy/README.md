# Native deployment

The Hono API runs in Cloudflare Workers or the portable Node image `deploy/hono/Dockerfile.api`. Trusted runner and verifier images use the separate targets in `deploy/hono/Dockerfile.runner`; untrusted cases remain isolated in the existing case sandbox images. Their credentials and signing keys stay outside case containers.

`.github/workflows/hono-stage-deploy.yaml` provisions and validates an isolated stage. `.github/workflows/hono-production.yaml` owns the authorized production cutover: preserve existing configuration, snapshot the existing Neon database, fence the Go runtime, migrate retained data, then activate native services and the API. Dispatch with an exact `release_sha`; `resume_prepared` resumes an already fenced setup. Frontend publication remains owned by `.github/workflows/frontend.yaml`.

Local release checks use `node scripts/hono-workload-validation.mjs` and `node scripts/hono-container-validation.mjs` with Docker and the documented fixture images. They do not deploy cloud resources or establish hosted performance.


## Private execution Workers

The runner drains from a release-scoped Durable Object. Verification runs in a
separate Worker with its own source credential and signing key. Case containers
still execute native runtimes and must confirm teardown before publication.
Portable Node deployments use the same engine and verifier.

Build the Worker modules with `node scripts/build-hono-service-workers.mjs`
before planning `hono-services`. The Terraform migration preserves runner,
case, and control namespaces, detaches the trusted execution containers, and
points the verifier hostname at its dedicated Worker. Stage with admission and
draining fenced for any existing environment. Validate authenticated runs,
multi-case checkpoint continuation, cancellation, teardown, and large retained
inputs before live cutover. Worker temporary files consume isolate memory.

Measure idle click-to-result p50 and p95 on staging using one-case Python Runs.
Report queue delivery, sandbox boot and teardown, and verification separately.
