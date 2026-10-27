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
    condition     = local.container_configuration.environment_variables[0].value == sha256(jsonencode(local.runtime)) && local.judge_configuration.environment_variables[0].value == sha256(jsonencode(local.judge_runtime))
    error_message = "Each role must roll when its runtime configuration changes."
  }
  assert {
    condition     = jsondecode(restapi_object.container.data).constraints.regions == ["ENAM"] && jsondecode(restapi_object.judge_container.update_data).constraints.regions == ["ENAM"]
    error_message = "App and judge placement must stay near the eastern US database."
  }
  assert {
    condition     = jsondecode([for binding in cloudflare_worker_version.app.bindings : binding.text if binding.name == "AUTH_PUBLIC_CONFIG"][0]).providers == ["google"]
    error_message = "The edge must receive public auth capabilities."
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
