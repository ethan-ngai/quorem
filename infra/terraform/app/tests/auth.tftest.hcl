mock_provider "cloudflare" {}
mock_provider "restapi" {}
mock_provider "random" {
  mock_resource "random_password" {
    defaults        = { result = "fixture-judge-control" }
    override_during = plan
  }
}
mock_provider "external" {
  mock_data "external" {
    defaults = { result = { tag = "v2" } }
  }
}

variables {
  account_id           = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  zone_id              = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  domain               = "example.com"
  image                = "registry.example.com/app:fixture"
  judge_image          = "registry.example.com/judge:fixture"
  case_image_revision  = "fixture"
  cloudflare_api_token = "fixture"
  database_url         = "postgres://fixture"
  better_auth_secret   = "fixture-auth-secret"
  auth_internal_secret = "fixture-internal-secret"
  invite_key           = "fixture-invite-key"
  auth_public_config = {
    method          = "password"
    preferredOrigin = "https://example.com"
    passkey         = true
    registration    = true
    providers       = ["google"]
  }
  auth_environment = {
    AUTH_LOGIN_ONLY      = "false"
    AUTH_EMAIL_DRIVER    = "smtp"
    AUTH_EMAIL_FROM      = "Quorem <accounts@example.com>"
    SMTP_HOST            = "smtp.purelymail.com"
    SMTP_PORT            = "465"
    SMTP_USERNAME        = "accounts@example.com"
    SMTP_PASSWORD        = "fixture-mail-password"
    GOOGLE_CLIENT_ID     = "fixture-google-id"
    GOOGLE_CLIENT_SECRET = "fixture-google-secret"
  }
}

run "auth_secrets_and_rollout" {
  command = plan
  assert {
    condition     = local.runtime.GUEST_CREATION_ENABLED == "true" && local.runtime.GUEST_ADMISSION_ENABLED == "true" && local.runtime.GUEST_EXECUTION_ENABLED == "true"
    error_message = "The bounded match guest pilot must enable creation, admission, and execution."
  }
  assert {
    condition     = local.runtime.AUTH_LOGIN_ONLY == "false" && local.runtime.SMTP_PASSWORD == "fixture-mail-password" && local.runtime.GOOGLE_CLIENT_ID == "fixture-google-id"
    error_message = "Application auth settings must reach its runtime."
  }
  assert {
    condition     = !contains(keys(local.judge_runtime), "SMTP_PASSWORD") && !contains(keys(local.judge_runtime), "GOOGLE_CLIENT_SECRET")
    error_message = "Auth secrets must not reach judges."
  }
  assert {
    condition     = local.judge_configuration.environment_variables[0].value == sha256(jsonencode(local.judge_runtime))
    error_message = "Judge containers must roll when their runtime configuration changes."
  }
  assert {
    condition     = [for binding in cloudflare_worker_version.app.bindings : binding.text if binding.name == "APP_RUNTIME_REVISION"][0] == sha256(jsonencode(local.runtime)) && jsondecode(restapi_object.container.data).max_instances == 2 * var.app_pool_shards * var.app_instances_per_shard
    error_message = "Each runtime revision needs distinct routing and capacity for draining connections."
  }
  assert {
    condition     = jsondecode(restapi_object.container.data).constraints.regions == ["ENAM"] && jsondecode(restapi_object.judge_container.update_data).constraints.regions == ["ENAM"]
    error_message = "App and judge placement must stay near the eastern US database."
  }
  assert {
    condition     = jsondecode([for binding in cloudflare_worker_version.app.bindings : binding.text if binding.name == "AUTH_PUBLIC_CONFIG"][0]).providers == ["google"]
    error_message = "The edge must receive public auth capabilities."
  }
  assert {
    condition     = jsondecode(restapi_object.fast_judge_container.data).scheduling_policy == "durable_object" && [for binding in local.fast_worker_config.metadata.bindings : binding.class_name if binding.name == "JUDGES"][0] == "FastJudge" && local.fast_worker_config.metadata.containers[2].images.judge == var.judge_image
    error_message = "Fast judges require a named image, a dedicated application and a matching Worker binding."
  }

}

run "guest_pause_controls" {
  command = plan
  variables {
    guest_creation_enabled  = false
    guest_admission_enabled = false
    guest_execution_enabled = false
  }
  assert {
    condition     = local.runtime.GUEST_CREATION_ENABLED == "false" && local.runtime.GUEST_ADMISSION_ENABLED == "false" && local.runtime.GUEST_EXECUTION_ENABLED == "false"
    error_message = "Guest rollout controls must support pausing each operation."
  }
}

run "reject_runtime_override" {
  command = plan
  variables {
    auth_environment = { DATABASE_URL = "postgres://override" }
  }
  expect_failures = [var.auth_environment]
}

run "alternate_auth_providers" {
  command = plan
  variables {
    auth_environment = {
      AUTH_MODE                        = "cognito"
      AUTH_LOGIN_ONLY                  = "false"
      COGNITO_CLIENT_ID                = "fixture-id"
      COGNITO_CLIENT_SECRET            = "fixture-secret"
      COGNITO_DOMAIN                   = "auth.example.com"
      COGNITO_REGION                   = "us-east-1"
      COGNITO_USERPOOL_ID              = "fixture-pool"
      AUTH_EMAIL_DRIVER                = "cloudflare"
      AUTH_EMAIL_FROM                  = "accounts@example.com"
      AUTH_EMAIL_CLOUDFLARE_ACCOUNT_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      AUTH_EMAIL_CLOUDFLARE_API_TOKEN  = "fixture-token"
    }
  }
  assert {
    condition     = local.runtime.AUTH_MODE == "cognito" && local.runtime.COGNITO_CLIENT_SECRET == "fixture-secret" && local.runtime.AUTH_EMAIL_CLOUDFLARE_API_TOKEN == "fixture-token"
    error_message = "Selected provider settings must reach the application runtime."
  }
  assert {
    condition     = !contains(keys(local.judge_runtime), "COGNITO_CLIENT_SECRET") && !contains(keys(local.judge_runtime), "AUTH_EMAIL_CLOUDFLARE_API_TOKEN")
    error_message = "Provider secrets must not reach judges."
  }
}

run "judging_rollout_defaults" {
  command = plan
  assert {
    condition     = local.runtime.QUOREM_LOSSLESS_CASES == "false" && local.runtime.QUOREM_LOSSLESS_RESULT_WRITES == "false" && local.judge_runtime.QUOREM_LOSSLESS_CASES == "false" && local.judge_runtime.QUOREM_LOSSLESS_RESULT_WRITES == "false" && local.judge_runtime.QUOREM_RESUMABLE_EXECUTION == "false"
    error_message = "Lossless cases, lossless results and resumable judging must default off for both roles."
  }
}

run "judges_first" {
  command = plan
  variables {
    judge_lossless_results    = true
    judge_lossless_cases      = true
    judge_resumable_execution = true
  }
  assert {
    condition     = local.runtime.QUOREM_LOSSLESS_CASES == "false" && local.runtime.QUOREM_LOSSLESS_RESULT_WRITES == "false" && local.judge_runtime.QUOREM_LOSSLESS_CASES == "true" && local.judge_runtime.QUOREM_LOSSLESS_RESULT_WRITES == "true" && local.judge_runtime.QUOREM_RESUMABLE_EXECUTION == "true"
    error_message = "Judge rollout must not enable API writes."
  }
  assert {
    condition     = local.judge_configuration.environment_variables[0].value == sha256(jsonencode(local.judge_runtime)) && [for binding in cloudflare_worker_version.app.bindings : binding.text if binding.name == "APP_RUNTIME_REVISION"][0] == sha256(jsonencode(local.runtime))
    error_message = "Both roles must fence their runtime configuration revisions."
  }
  assert {
    condition     = sha256(jsonencode(local.judge_runtime)) != sha256(jsonencode(merge(local.judge_runtime, { QUOREM_LOSSLESS_CASES = "false", QUOREM_LOSSLESS_RESULT_WRITES = "false", QUOREM_RESUMABLE_EXECUTION = "false" })))
    error_message = "Judge capability changes must change the judge runtime revision."
  }
  assert {
    condition     = [for binding in local.fast_worker_config.metadata.bindings : binding.text if binding.name == "JUDGE_FAST_REVISION"][0] == sha256(jsonencode([var.judge_image, local.judge_runtime, var.judge_vcpu, var.judge_memory_mib])) && jsondecode([for binding in local.fast_worker_config.metadata.bindings : binding.text if binding.name == "JUDGE_RUNTIME_ENV"][0]).QUOREM_LOSSLESS_CASES == "true"
    error_message = "Fast judges must receive the enabled runtime and matching revision."
  }
}

run "api_after_judges" {
  command = plan
  variables {
    api_lossless_results   = true
    api_lossless_cases     = true
    judge_lossless_results = true
    judge_lossless_cases   = true
  }
  assert {
    condition     = local.runtime.QUOREM_LOSSLESS_CASES == "true" && local.runtime.QUOREM_LOSSLESS_RESULT_WRITES == "true" && local.judge_runtime.QUOREM_LOSSLESS_CASES == "true" && local.judge_runtime.QUOREM_LOSSLESS_RESULT_WRITES == "true"
    error_message = "Enabled lossless cases require both roles and result writers."
  }
  assert {
    condition     = sha256(jsonencode(local.runtime)) != sha256(jsonencode(merge(local.runtime, { QUOREM_LOSSLESS_CASES = "false", QUOREM_LOSSLESS_RESULT_WRITES = "false" })))
    error_message = "API capability changes must change the API runtime revision."
  }
}

run "reject_judge_cases_without_results" {
  command = plan
  variables { judge_lossless_cases = true }
  expect_failures = [var.judge_lossless_cases]
}

run "reject_api_cases_without_judges" {
  command = plan
  variables {
    api_lossless_results = true
    api_lossless_cases   = true
  }
  expect_failures = [var.api_lossless_cases]
}

run "reject_api_cases_without_results" {
  command = plan
  variables {
    api_lossless_cases     = true
    judge_lossless_cases   = true
    judge_lossless_results = true
  }
  expect_failures = [var.api_lossless_cases]
}
