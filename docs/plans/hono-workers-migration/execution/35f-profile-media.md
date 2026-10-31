# 35f Staged profile media

Optional `profile_media_enabled` creates a fresh staged R2 bucket and separately hosted ImageService. Bind the returned bucket as `PROFILE_BUCKET`. Existing avatar objects are not copied; their cutover is required before production activation.

The service module takes a distinct `image_hostname`, digest-pinned `image_service_image`, and `IMAGE_SERVICE_TOKEN`. The HTTPS image endpoint requires that purpose-scoped bearer. Its container receives no runner, verifier, case or object-store credentials. Set the Worker `PROFILE_IMAGE_SERVICE_URL`, `PROFILE_IMAGE_SERVICE_TOKEN` and `PROFILE_IMAGE_ACCESS_MODE=none`. The response retains its execution termination proof header. Workers.dev and preview URLs remain disabled.

The image Durable Object class uses the staged migration history; existing namespaces must not be recreated. The R2 bucket has `prevent_destroy`; disabling an existing bucket requires an explicit retention decision.

Local tests exercise bearer-protected ingress and real Sharp processing. Hosted image execution, teardown, R2 access, Custom Domain routing and existing-object migration remain unverified. Container inactivity settings do not prove completion or teardown. [Cloudflare Containers](https://developers.cloudflare.com/containers/api/durable-object-container/)
