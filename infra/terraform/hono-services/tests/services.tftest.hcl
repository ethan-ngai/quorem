mock_provider "cloudflare" {}
mock_provider "restapi" {}
mock_provider "external" {
  mock_data "external" { defaults = { result = { tag = "" } } }
}
variables {
  release_sha          = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
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
    IMAGE_SERVICE_TOKEN                 = "image-fixture-token-0123456789abcdef"
    RECOVERY_CONTROL_SECRET             = "recovery-control-fixture-distinct-strong"
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
    condition     = cloudflare_worker.services.subdomain.enabled == false && length(cloudflare_worker_version.services.containers) == 3 && cloudflare_worker_version.services.migrations.new_tag == "v3"
    error_message = "Private Worker must be isolated, with its own three container classes."
  }
  assert {
    condition     = length(cloudflare_zero_trust_access_application.service) == 3 && cloudflare_zero_trust_access_application.service["case"].domain == "case-stage.example.com/internal/*"
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
    condition     = cloudflare_worker_version.services.migrations.new_tag == "v3" && toset(cloudflare_worker_version.services.migrations.new_sqlite_classes) == toset(["CaseControl", "RunnerReleaseControl"])
    error_message = "Existing v1 retains every original namespace and adds controls only."
  }
}
run "reject_unknown_migration" {
  command = plan
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v5" } }
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

  }
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations.new_tag == "v4" && length(cloudflare_worker_version.services.migrations.new_sqlite_classes) == 6 && length(cloudflare_workers_route.service) == 4 && cloudflare_zero_trust_access_application.service["image"].domain == "image-stage.example.com"
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

  }
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v1" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations.old_tag == "v1" && cloudflare_worker_version.services.migrations.new_tag == "v4" && toset(cloudflare_worker_version.services.migrations.new_sqlite_classes) == toset(["CaseControl", "RunnerReleaseControl", "ImageService"])
    error_message = "Upgrade preserves original classes and adds only controls and image processing."
  }
}
run "repeat_v2" {
  command = plan
  variables {
    profile_media_enabled         = true
    image_hostname                = "image-stage.example.com"
    image_access_service_token_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    image_service_image           = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

  }
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v2" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations.new_tag == "v4" && toset(cloudflare_worker_version.services.migrations.new_sqlite_classes) == toset(["CaseControl", "RunnerReleaseControl"])
    error_message = "Existing v2 adds only controls, preserving image and case namespaces."
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
    condition     = cloudflare_worker_version.services.migrations.new_tag == "v4" && toset(cloudflare_worker_version.services.migrations.new_sqlite_classes) == toset(["CaseControl", "RunnerReleaseControl"]) && length(cloudflare_workers_route.service) == 3
    error_message = "Disabling media must not recreate or delete DO classes."
  }
}

run "repeat_v3" {
  command = plan
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v3" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations == null
    error_message = "Control namespaces must not be recreated."
  }
}
run "repeat_v4" {
  command = plan
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v4" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations == null
    error_message = "Image and control namespaces must not be recreated."
  }
}
run "control_authority_and_access" {
  command = plan
  override_resource {
    target          = cloudflare_zero_trust_access_application.service["drain"]
    values          = { id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }
    override_during = plan
  }
  assert {
    condition     = local.public.SERVICES_RELEASE == var.release_sha && local.public.SERVICES_GENERATION == "1" && length(local.public.SERVICES_BINDINGS) == 64 && length([for binding in local.bindings : binding if try(binding.name == "CASE_CONTROL" || binding.name == "RUNNER_CONTROL", false)]) == 2 && cloudflare_zero_trust_access_application.service["drain"].domain == "runner-stage.example.com/internal/*"
    error_message = "Execution controls and pause must be configured and Access-protected."
  }
  assert {
    condition     = output.drain_access_application_id == cloudflare_zero_trust_access_application.service["drain"].id && one(cloudflare_zero_trust_access_policy.service["drain"].include).service_token.token_id == var.access_token_ids.drain
    error_message = "The exported drain application must be the service-owned ingress policy."
  }
}

run "add_image_to_v3" {
  command = plan
  variables {
    profile_media_enabled         = true
    image_hostname                = "image-stage.example.com"
    image_access_service_token_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    image_service_image           = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v3" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations.new_tag == "v4" && toset(cloudflare_worker_version.services.migrations.new_sqlite_classes) == toset(["ImageService"])
    error_message = "Enabling media after control activation must add only ImageService."
  }
}
