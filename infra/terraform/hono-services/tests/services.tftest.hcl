mock_provider "cloudflare" {}
mock_provider "restapi" {}
variables {
  account_id           = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  zone_id              = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  cloudflare_api_token = "fixture-token"
  worker_name          = "quorem-hono-services-stage"
  hostnames            = { drain = "runner-stage.example.com", verifier = "verifier-stage.example.com", case = "case-stage.example.com" }
  dns_target           = "stage-origin.example.com"
  access_token_ids     = { drain = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", verifier = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", case = "cccccccc-cccc-cccc-cccc-cccccccccccc" }
  runner_image         = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/runner@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  verifier_image       = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/verifier@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  case_images          = { python = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/python@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", java = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/java@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", typescript = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/typescript@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ocaml = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ocaml@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", postgresql = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/postgresql@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  command_origin       = "https://api-stage.example.com"
  source_origin        = "https://api-stage.example.com"
  case_namespace_id    = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  service_secrets = {
    QUOREM_RUNNER_COMMAND_SECRET        = "runner-command-fixture"
    QUOREM_RUNNER_DRAIN_SECRET          = "runner-drain-fixture"
    QUOREM_CASE_SECRET                  = "case-secret-fixture"
    QUOREM_VERIFICATION_SOURCE_KEY      = "source-key-fixture"
    QUOREM_VERIFICATION_SERVICE_KEY     = "service-key-fixture"
    QUOREM_CASE_OWNER_PUBLIC_KEY_PEM    = "public-key-fixture"
    QUOREM_VERIFICATION_SIGNING_KEY_PEM = "signing-key-fixture"
    RUNNER_API_ACCESS_CLIENT_ID         = "runner-api-id"
    RUNNER_API_ACCESS_CLIENT_SECRET     = "runner-api-secret"
    VERIFIER_API_ACCESS_CLIENT_ID       = "verifier-api-id"
    VERIFIER_API_ACCESS_CLIENT_SECRET   = "verifier-api-secret"
    QUOREM_CASE_ACCESS_CLIENT_ID        = "case-api-id"
    QUOREM_CASE_ACCESS_CLIENT_SECRET    = "case-api-secret"
    CASE_OWNER_PRIVATE_KEY              = "case-owner-private"
  }
}
run "isolated_stage" {
  command = plan
  assert {
    condition     = cloudflare_worker.services.subdomain.enabled == false && length(cloudflare_worker_version.services.containers) == 3 && cloudflare_worker_version.services.migrations.new_tag == "v1"
    error_message = "Private Worker must be isolated, with its own three container classes."
  }
  assert {
    condition     = length(cloudflare_zero_trust_access_application.service) == 3 && cloudflare_zero_trust_access_application.service["case"].domain == "case-stage.example.com/internal/case/*"
    error_message = "Each private capability needs a scoped Access application."
  }
  assert {
    condition     = length(restapi_object.trusted) == 2 && length(restapi_object.trusted_rollout) == 2 && length(cloudflare_workers_route.service) == 3
    error_message = "Terraform must own the two trusted containers and three isolated routes."
  }
}
run "reject_live_name" {
  command = plan
  variables { worker_name = "quorem-production" }
  expect_failures = [var.worker_name]
}
run "reject_shared_access_token" {
  command = plan
  variables { access_token_ids = { drain = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", verifier = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", case = "cccccccc-cccc-cccc-cccc-cccccccccccc" } }
  expect_failures = [var.access_token_ids]
}
