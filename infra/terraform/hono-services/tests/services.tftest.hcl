mock_provider "cloudflare" {}
mock_provider "restapi" {}
mock_provider "external" {
  mock_data "external" { defaults = { result = { tag = "" } } }
}
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
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "" } }
    override_during = plan
  }
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

run "existing_v1_reuses_classes" {
  command = plan
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v1" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations == null
    error_message = "An existing v1 Worker must not recreate its Durable Object classes."
  }
}
run "reject_unknown_migration" {
  command = plan
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v4" } }
    override_during = plan
  }
  expect_failures = [cloudflare_worker_version.services]
}

run "fresh_image" {
  command = plan
  variables {
    profile_media_enabled         = true
    image_hostname                = "image-stage.example.com"
    image_access_service_token_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    image_service_image           = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
      IMAGE_SERVICE_TOKEN                 = "image-fixture-token-0123456789abcdef"
      CASE_OWNER_PRIVATE_KEY              = "case-owner-private"
    }
  }
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations.new_tag == "v2" && length(cloudflare_worker_version.services.migrations.new_sqlite_classes) == 4 && length(cloudflare_workers_route.service) == 4 && cloudflare_zero_trust_access_application.service["image"].domain == "image-stage.example.com"
    error_message = "Fresh image stage must isolate all four services."
  }
}
run "add_image_to_v1" {
  command = plan
  variables {
    profile_media_enabled         = true
    image_hostname                = "image-stage.example.com"
    image_access_service_token_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    image_service_image           = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
      IMAGE_SERVICE_TOKEN                 = "image-fixture-token-0123456789abcdef"
      CASE_OWNER_PRIVATE_KEY              = "case-owner-private"
    }
  }
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v1" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations.old_tag == "v1" && cloudflare_worker_version.services.migrations.new_tag == "v2" && toset(cloudflare_worker_version.services.migrations.new_sqlite_classes) == toset(["ImageService"])
    error_message = "Upgrade must add only the image class."
  }
}
run "repeat_v2" {
  command = plan
  variables {
    profile_media_enabled         = true
    image_hostname                = "image-stage.example.com"
    image_access_service_token_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    image_service_image           = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
      IMAGE_SERVICE_TOKEN                 = "image-fixture-token-0123456789abcdef"
      CASE_OWNER_PRIVATE_KEY              = "case-owner-private"
    }
  }
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v2" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations == null
    error_message = "Repeat deploy must not recreate v2 classes."
  }
}
run "disabled_after_v2" {
  command = plan
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v2" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations == null && length(cloudflare_workers_route.service) == 3
    error_message = "Disabling media must not recreate or delete DO classes."
  }
}
