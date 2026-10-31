mock_provider "neon" {
  override_during = plan
  mock_resource "neon_project" {
    defaults = {
      id                = "fixture-stage-project"
      database_host     = "fixture-stage.neon.example"
      database_name     = "quorem_hono_stage"
      database_user     = "quorem_stage_owner"
      database_password = "fixture-only"
    }
  }
}
mock_provider "cloudflare" {
  override_during = plan
  mock_resource "cloudflare_zero_trust_access_service_token" {
    defaults = { id = "fixture-id", client_id = "fixture-client", client_secret = "fixture-secret" }
  }
}

variables {
  account_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  stage_secrets = { for key in [
    "RECOVERY_CONTROL_SECRET", "QUOREM_RUNNER_COMMAND_SECRET", "QUOREM_RUNNER_DRAIN_SECRET",
    "QUOREM_CASE_SECRET", "QUOREM_VERIFICATION_SOURCE_KEY", "QUOREM_VERIFICATION_SERVICE_KEY",
    "IMAGE_SERVICE_TOKEN", "QUOREM_CASE_OWNER_PUBLIC_KEY_PEM", "CASE_OWNER_PRIVATE_KEY",
    "QUOREM_VERIFICATION_SIGNING_KEY_PEM", "VERIFICATION_PUBLIC_KEY", "MATCH_INVITE_KEY",
    "BETTER_AUTH_SECRET", "AUTH_INTERNAL_SECRET", "STAGE_RUNTIME_DATABASE_PASSWORD"
  ] : key => "fixture-only" }
}

run "isolated_bootstrap" {
  command = plan
  assert {
    condition     = neon_project.stage.name == "quorem-hono-stage" && neon_project.stage.branch[0].name == "stage" && neon_project.stage.branch[0].database_name == "quorem_hono_stage" && neon_project.stage.branch[0].role_name == "quorem_stage_owner"
    error_message = "A new isolated project and staged root branch are required."
  }
  assert {
    condition     = neon_project.stage.primary_compute[0].autoscaling_limit_min_cu == 0.25 && neon_project.stage.primary_compute[0].autoscaling_limit_max_cu == 1 && neon_project.stage.primary_compute[0].suspend_timeout_seconds == 0
    error_message = "Staged compute must use bounded autoscaling and default suspension."
  }
  assert {
    condition     = length(keys(nonsensitive(terraform_data.stage_secrets.input))) == 15
    error_message = "The initial application credentials must be retained as one protected record."
  }
  assert {
    condition     = toset(keys(cloudflare_zero_trust_access_service_token.stage)) == toset(["runner_api", "verifier_api", "drain", "verifier", "case", "image"]) && length(toset([for token in cloudflare_zero_trust_access_service_token.stage : token.name])) == 6
    error_message = "Each service capability needs its own token."
  }
  assert {
    condition     = nonsensitive(output.database_url) == "postgresql://quorem_stage_owner:fixture-only@fixture-stage.neon.example/quorem_hono_stage?sslmode=verify-full"
    error_message = "The migration URL must use the direct staged origin and verified TLS."
  }
  assert {
    condition     = toset(keys(nonsensitive(output.access_tokens))) == toset(["runner_api", "verifier_api", "drain", "verifier", "case", "image"]) && alltrue([for token in values(nonsensitive(output.access_tokens)) : length(token.id) > 0 && length(token.client_id) > 0 && length(token.client_secret) > 0])
    error_message = "Each token output must provide its own credentials."
  }
}

run "reject_invalid_account" {
  command = plan
  variables { account_id = "not-a-cloudflare-account" }
  expect_failures = [var.account_id]
}

run "reject_missing_application_secrets" {
  command = plan
  variables { stage_secrets = {} }
  expect_failures = [var.stage_secrets]
}
