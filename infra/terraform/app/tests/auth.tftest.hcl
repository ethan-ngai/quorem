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

run "reject_runtime_override" {
  command = plan
  variables {
    auth_environment = { DATABASE_URL = "postgres://override" }
  }
  expect_failures = [var.auth_environment]
}
