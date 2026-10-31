# 35f: staged profile media

Optional `profile_media_enabled` creates a fresh staged R2 bucket and a separately hosted ImageService. The stage Worker must bind the returned `profile_bucket_name` as `PROFILE_BUCKET`; no existing avatar objects are copied. Source-object cutover is required before production activation.

The service module needs a distinct staged `image_hostname`, `image_access_service_token_id`, digest-pinned account-local `image_service_image`, and `IMAGE_SERVICE_TOKEN` in `service_secrets`. The host is protected by its own Access application and bearer. Only the bearer reaches the image container; its process receives no runner, verifier, case, or object-store credentials. The API config uses `PROFILE_IMAGE_SERVICE_URL`, `PROFILE_IMAGE_SERVICE_TOKEN`, and a separate `PROFILE_IMAGE_ACCESS_MODE=cloudflare-access` client pair. The response, including the termination proof header, is forwarded unchanged. Worker preview and workers.dev routes remain disabled.

The image class is added as migration v2: a fresh stage creates all four classes; an existing v1 stage adds only ImageService. Repeated v2 plans do not recreate classes. The R2 bucket has `prevent_destroy`; disabling an existing bucket requires an explicit data-retention decision and Terraform state change.

Runner idle timeout is 300 seconds for the 210-second drain budget. Cloudflare documents inactivity-based timeouts but also says active containers can stop due to platform events; this setting proves neither completion nor teardown. Attested cleanup and fences remain mandatory. Hosted long-drain, crash, private-ingress, container isolation, and object migration acceptance remain release gates. No cloud deployment or data transfer was performed.

Sources: https://developers.cloudflare.com/containers/api/durable-object-container/ and https://developers.cloudflare.com/containers/faq/.

Local verification: `terraform -chdir=infra/terraform/hono-stage test` (10 passed), `terraform -chdir=infra/terraform/hono-services test` (9 passed), `node --import ./deploy/test-register.mjs --test deploy/router.test.mjs deploy/hono/services/worker.test.mjs` (40 passed), `vp -C apps/api exec vitest run --config src/runtime/composition/vitest.services.config.ts` (2 passed), and `docker build -f deploy/hono/services/Dockerfile.image -t quorem-35f-image-fixture:local .` followed by `node --test deploy/hono/services/image-media.test.mjs` (1 passed, authenticated health and real Sharp output). These do not establish hosted deployment behavior.
