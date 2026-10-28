mock_provider "cloudflare" {}
mock_provider "restapi" {}
mock_provider "external" {
  mock_data "external" {
    defaults        = { result = { name = "fixture" } }
    override_during = plan
  }
}
variables {
  account_id           = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  cloudflare_api_token = "fixture"
  validation_token     = "fixture-token-at-least-32-characters"
  name                 = "quorem-validation-123"
  image_revision       = "0123456789abcdef0123456789abcdef01234567"
}
run "isolated_case_application" {
  command = plan
  assert {
    condition     = jsondecode(restapi_object.case.data).scheduling_policy == "durable_object" && local.origin == "https://quorem-validation-123.fixture.workers.dev" && length(local.images) == 5 && cloudflare_worker.test.observability.enabled
    error_message = "Validation must use a run-scoped Worker and isolated case images."
  }
}
run "reject_production_worker" {
  command = plan
  variables { name = "quorem-production" }
  expect_failures = [var.name]
}
