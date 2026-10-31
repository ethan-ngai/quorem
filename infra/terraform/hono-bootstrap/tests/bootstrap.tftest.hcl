mock_provider "restapi" {
  override_during = plan
  mock_resource "restapi_object" { defaults = { id = "br-stage-fixture" } }
}
mock_provider "neon" {
  override_during = plan
  mock_resource "neon_endpoint" { defaults = { host = "fixture-stage.neon.example" } }
  mock_resource "neon_role" { defaults = { password = "fixture-only" } }
}
variables {
  project_id   = "existing-project-fixture"
  neon_api_key = "fixture-only"
  stage_secrets = { for key in [
    "RECOVERY_CONTROL_SECRET", "QUOREM_RUNNER_COMMAND_SECRET", "QUOREM_RUNNER_DRAIN_SECRET",
    "QUOREM_CASE_SECRET", "QUOREM_VERIFICATION_SOURCE_KEY", "QUOREM_VERIFICATION_SERVICE_KEY",
    "IMAGE_SERVICE_TOKEN", "QUOREM_CASE_OWNER_PUBLIC_KEY_PEM", "CASE_OWNER_PRIVATE_KEY",
    "QUOREM_VERIFICATION_SIGNING_KEY_PEM", "VERIFICATION_PUBLIC_KEY", "MATCH_INVITE_KEY",
    "BETTER_AUTH_SECRET", "AUTH_INTERNAL_SECRET", "STAGE_RUNTIME_DATABASE_PASSWORD"
  ] : key => "fixture-only" }
}
run "isolated_schema_only_branch" {
  command = plan
  assert {
    condition     = restapi_object.stage_branch.path == "/projects/existing-project-fixture/branches" && jsondecode(restapi_object.stage_branch.data).branch.name == "quorem-hono-stage" && jsondecode(restapi_object.stage_branch.data).branch.init_source == "schema-only" && restapi_object.stage_branch.ignore_all_server_changes
    error_message = "A separate schema-only branch must be created in the supplied project."
  }
  assert {
    condition     = neon_endpoint.stage.branch_id == "br-stage-fixture" && neon_endpoint.stage.type == "read_write" && neon_endpoint.stage.autoscaling_limit_min_cu == 0.25 && neon_endpoint.stage.autoscaling_limit_max_cu == 1 && neon_endpoint.stage.suspend_timeout_seconds == 0
    error_message = "The independent compute must be bounded and use the staged branch."
  }
  assert {
    condition     = neon_role.stage.branch_id == "br-stage-fixture" && neon_role.stage.name == "quorem_stage_owner" && neon_database.stage.branch_id == "br-stage-fixture" && neon_database.stage.name == "quorem_hono_stage" && neon_database.stage.owner_name == "quorem_stage_owner"
    error_message = "An empty dedicated database and owner must belong to the staged branch."
  }
  assert {
    condition     = length(keys(nonsensitive(terraform_data.stage_secrets.input))) == 15 && output.project_id == "existing-project-fixture" && output.branch_id == "br-stage-fixture"
    error_message = "Preserve the existing application credential state and branch identity."
  }
  assert {
    condition     = nonsensitive(output.database_url) == "postgresql://quorem_stage_owner:fixture-only@fixture-stage.neon.example/quorem_hono_stage?sslmode=verify-full"
    error_message = "The migration URL must use the direct staged endpoint with verified TLS."
  }
}
run "reject_invalid_project" {
  command = plan
  variables { project_id = "not/a/project" }
  expect_failures = [var.project_id]
}
run "reject_missing_application_secrets" {
  command = plan
  variables { stage_secrets = {} }
  expect_failures = [var.stage_secrets]
}
