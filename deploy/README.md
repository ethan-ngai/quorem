# Native deployment

The Hono API runs in Cloudflare Workers or the portable Node image `deploy/hono/Dockerfile.api`. Trusted runner and verifier images use the separate targets in `deploy/hono/Dockerfile.runner`; untrusted cases remain isolated in the existing case sandbox images. Their credentials and signing keys stay outside case containers.

`.github/workflows/hono-stage-deploy.yaml` provisions and validates an isolated stage. Use `.github/workflows/hono-production.yaml` on `main` with an exact `release_sha` to inspect the active API, apply API updates, or coordinate a private Worker release. `.github/workflows/frontend.yaml` provisions and publishes Pages.

Local release checks use `node scripts/hono-workload-validation.mjs` and `node scripts/hono-container-validation.mjs` with Docker and the documented fixture images. They do not deploy cloud resources or establish hosted performance.


## Private execution Workers

The release-scoped Durable Object gates drains and invokes the API Worker once
per drain. The API Worker runs the shared judge against PostgreSQL directly.
The verifier independently reads a frozen bundle and returns small verified
fields with its signed receipt. Large fields use the paged protocol. Native case
containers confirm teardown before publication. Portable Node deployments use
the same engine and verifier.

Build the Worker modules with `node scripts/build-hono-service-workers.mjs`
before planning `hono-services`. The Terraform migration preserves runner,
case, and control namespaces, detaches the trusted execution containers, and
points the verifier hostname at its dedicated Worker. Stage with admission and
draining fenced for any existing environment. Validate authenticated runs,
multi-case checkpoint continuation, cancellation, teardown, and large retained
inputs before live cutover. Worker temporary files consume isolate memory.

Measure idle click-to-result p50 and p95 on staging using one-case Python Runs.
Report queue delivery, sandbox boot and teardown, and verification separately.


For the batched judging protocol, deploy the API Worker first. Then release the
private Workers through the existing fenced rollout. The API exposes the bundle
and drain endpoints before either private Worker starts calling them.

Validate a failed post-commit wake through the scheduled outbox scan. Record
normal and recovered admission-to-claim latency separately. Benchmark fresh
one-case Python Runs by admission, claim, sandbox, verification, and publish.
Measure p50 and p95 before assessing the 3–5 second target or scheduling multiple
cases concurrently.
