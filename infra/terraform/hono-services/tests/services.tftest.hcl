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
    condition     = cloudflare_worker.services.subdomain.enabled == false && cloudflare_worker.services.subdomain.previews_enabled == false && length(cloudflare_worker_version.services.containers) == 1 && cloudflare_worker_version.services.migrations.new_tag == "v7"
    error_message = "Private Worker must be isolated, with only the native case container class."
  }

  assert {
    condition     = alltrue([for key, host in local.service_hosts : cloudflare_workers_custom_domain.service[key].hostname == host && cloudflare_workers_custom_domain.service[key].service == (key == "verifier" ? cloudflare_worker.verifier.name : cloudflare_worker.services.name) && cloudflare_workers_custom_domain.service[key].zone_id == var.zone_id])
    error_message = "Every private hostname must target the staged Worker custom domain."
  }
  assert {
    condition     = length(restapi_object.trusted) == 0 && length(restapi_object.trusted_rollout) == 0 && length(cloudflare_workers_custom_domain.service) == 3
    error_message = "Terraform must own three isolated custom domains."
  }
}
run "verification_source_binding" {
  command = plan
  assert {
    condition     = length([for binding in cloudflare_worker_version.verifier.bindings : binding if binding.name == "VERIFICATION_SOURCE" && binding.type == "service" && binding.service == "quorem-hono-stage"]) == 1
    error_message = "Proof reads must use the matching API Worker service binding."
  }
}
run "reject_live_name" {
  command = plan
  variables { worker_name = "quorem-production" }
  expect_failures = [var.worker_name]
}
run "reject_missing_bearer" {
  command = plan
  variables {
    service_secrets = {
      RECOVERY_CONTROL_SECRET             = "recovery-control-fixture-distinct-strong"
      QUOREM_RUNNER_COMMAND_SECRET        = "runner-command-fixture"
      QUOREM_RUNNER_DRAIN_SECRET          = "runner-drain-fixture"
      QUOREM_VERIFICATION_SOURCE_KEY      = "source-key-fixture"
      QUOREM_VERIFICATION_SERVICE_KEY     = "service-key-fixture"
      QUOREM_CASE_OWNER_PUBLIC_KEY_PEM    = "public-key-fixture"
      QUOREM_VERIFICATION_SIGNING_KEY_PEM = "signing-key-fixture"
      CASE_OWNER_PRIVATE_KEY              = "case-owner-private"
    }
  }
  expect_failures = [var.service_secrets]
}
run "reject_weak_recovery_bearer" {
  command = plan
  variables {
    service_secrets = {
      RECOVERY_CONTROL_SECRET             = "short"
      QUOREM_RUNNER_COMMAND_SECRET        = "runner-command-fixture"
      QUOREM_RUNNER_DRAIN_SECRET          = "runner-drain-fixture"
      QUOREM_CASE_SECRET                  = "case-secret-fixture"
      QUOREM_VERIFICATION_SOURCE_KEY      = "source-key-fixture"
      QUOREM_VERIFICATION_SERVICE_KEY     = "service-key-fixture"
      QUOREM_CASE_OWNER_PUBLIC_KEY_PEM    = "public-key-fixture"
      QUOREM_VERIFICATION_SIGNING_KEY_PEM = "signing-key-fixture"
      CASE_OWNER_PRIVATE_KEY              = "case-owner-private"
    }
  }
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "" } }
    override_during = plan
  }
  expect_failures = [cloudflare_worker_version.services]
}
run "existing_v1_reuses_classes" {
  command = plan
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v1" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations.new_tag == "v7" && toset(cloudflare_worker_version.services.migrations.new_sqlite_classes) == toset(["CaseControl", "RunnerReleaseControl"]) && toset(cloudflare_worker_version.services.migrations.deleted_classes) == toset(["VerifierService"])
    error_message = "Existing v1 retains runner and case namespaces, removes the verifier namespace, and adds controls."
  }
}
run "reject_unknown_migration" {
  command = plan
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v99" } }
    override_during = plan
  }
  expect_failures = [cloudflare_worker_version.services]
}

run "fresh_image" {
  command = plan
  variables {
    profile_media_enabled = true
    image_hostname        = "image-stage.example.com"
    image_service_image   = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

  }
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations.new_tag == "v8" && length(cloudflare_worker_version.services.migrations.new_sqlite_classes) == 5 && length(cloudflare_workers_custom_domain.service) == 4 && cloudflare_workers_custom_domain.service["image"].hostname == "image-stage.example.com"
    error_message = "Fresh image stage must isolate all four services."
  }
}
run "add_image_to_v1" {
  command = plan
  variables {
    profile_media_enabled = true
    image_hostname        = "image-stage.example.com"
    image_service_image   = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

  }
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v1" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations.old_tag == "v1" && cloudflare_worker_version.services.migrations.new_tag == "v8" && toset(cloudflare_worker_version.services.migrations.new_sqlite_classes) == toset(["CaseControl", "RunnerReleaseControl", "ImageService"])
    error_message = "Upgrade preserves original classes and adds only controls and image processing."
  }
}
run "repeat_v2" {
  command = plan
  variables {
    profile_media_enabled = true
    image_hostname        = "image-stage.example.com"
    image_service_image   = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

  }
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v2" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations.new_tag == "v8" && toset(cloudflare_worker_version.services.migrations.new_sqlite_classes) == toset(["CaseControl", "RunnerReleaseControl"])
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
    condition     = cloudflare_worker_version.services.migrations.new_tag == "v8" && toset(cloudflare_worker_version.services.migrations.new_sqlite_classes) == toset(["CaseControl", "RunnerReleaseControl"]) && length(cloudflare_workers_custom_domain.service) == 3
    error_message = "Disabling media must not recreate or delete DO classes."
  }
}

run "repeat_v7" {
  command = plan
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v7" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations == null
    error_message = "Control namespaces must not be recreated."
  }
}
run "repeat_v8" {
  command = plan
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v8" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations == null
    error_message = "Image and control namespaces must not be recreated."
  }
}
run "control_authority_and_bearers" {
  command = plan
  assert {
    condition     = local.public.SERVICES_RELEASE == var.release_sha && local.public.SERVICES_GENERATION == "1" && length(local.public.SERVICES_BINDINGS) == 64 && length([for binding in local.bindings : binding if try(binding.name == "CASE_CONTROL" || binding.name == "RUNNER_CONTROL", false)]) == 2
    error_message = "Execution controls must remain bound to this release."
  }
  assert {
    condition     = alltrue([for name in ["RECOVERY_CONTROL_SECRET", "QUOREM_RUNNER_COMMAND_SECRET", "QUOREM_RUNNER_DRAIN_SECRET", "QUOREM_CASE_SECRET", "QUOREM_VERIFICATION_SOURCE_KEY", "QUOREM_VERIFICATION_SERVICE_KEY"] : contains(concat(local.secret_names, local.verifier_secrets), name)]) && length([for name in local.secret_names : name if strcontains(name, "ACCESS_CLIENT")]) == 0
    error_message = "Private services must retain application bearers without Access bindings."
  }
  assert {
    condition     = alltrue([for name in local.verifier_secrets : !contains([for binding in local.bindings : binding.name], name) && contains([for binding in cloudflare_worker_version.verifier.bindings : binding.name], name)])
    error_message = "Verification credentials and signing key must be bound to the verifier only."
  }
}

run "add_image_to_v3" {
  command = plan
  variables {
    profile_media_enabled = true
    image_hostname        = "image-stage.example.com"
    image_service_image   = "registry.cloudflare.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  override_data {
    target          = data.external.worker_migration
    values          = { result = { tag = "v3" } }
    override_during = plan
  }
  assert {
    condition     = cloudflare_worker_version.services.migrations.new_tag == "v8" && toset(cloudflare_worker_version.services.migrations.new_sqlite_classes) == toset(["ImageService"])
    error_message = "Enabling media after control activation must add only ImageService."
  }
}
