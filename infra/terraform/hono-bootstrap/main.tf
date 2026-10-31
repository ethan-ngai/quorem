terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  backend "s3" {}
  required_providers {
    neon    = { source = "kislerdm/neon", version = "0.18.0" }
    restapi = { source = "Mastercard/restapi", version = "~> 2.0" }
  }
}

variable "project_id" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9-]{1,60}$", var.project_id))
    error_message = "A valid existing Neon project ID is required."
  }
}
variable "neon_api_key" {
  type      = string
  sensitive = true
  validation {
    condition     = length(var.neon_api_key) > 0
    error_message = "A Neon API key is required."
  }
}

# Persist the first activation's credentials; rotation is a separate audited operation.
variable "stage_secrets" {
  type      = map(string)
  sensitive = true
  validation {
    condition = nonsensitive(toset(keys(var.stage_secrets))) == toset([
      "RECOVERY_CONTROL_SECRET", "QUOREM_RUNNER_COMMAND_SECRET", "QUOREM_RUNNER_DRAIN_SECRET",
      "QUOREM_CASE_SECRET", "QUOREM_VERIFICATION_SOURCE_KEY", "QUOREM_VERIFICATION_SERVICE_KEY",
      "IMAGE_SERVICE_TOKEN", "QUOREM_CASE_OWNER_PUBLIC_KEY_PEM", "CASE_OWNER_PRIVATE_KEY",
      "QUOREM_VERIFICATION_SIGNING_KEY_PEM", "VERIFICATION_PUBLIC_KEY", "MATCH_INVITE_KEY",
      "BETTER_AUTH_SECRET", "AUTH_INTERNAL_SECRET", "STAGE_RUNTIME_DATABASE_PASSWORD",
    ]) && nonsensitive(alltrue([for value in values(var.stage_secrets) : length(value) > 0]))
    error_message = "A complete staged application credential set is required."
  }
}

resource "terraform_data" "stage_secrets" {
  input = var.stage_secrets
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [input]
  }
}

output "stage_secrets" {
  value     = terraform_data.stage_secrets.output
  sensitive = true
}

provider "neon" { api_key = var.neon_api_key }
provider "restapi" {
  uri                  = "https://console.neon.tech/api/v2"
  write_returns_object = true
  id_attribute         = "branch/id"
  headers              = { "Content-Type" = "application/json", "Authorization" = "Bearer ${var.neon_api_key}" }
}

# Schema-only creates an independent root; the stage database below starts empty.
resource "restapi_object" "stage_branch" {
  path                      = "/projects/${var.project_id}/branches"
  data                      = jsonencode({ branch = { name = "quorem-hono-stage", init_source = "schema-only" } })
  ignore_all_server_changes = true
  lifecycle { prevent_destroy = true }
}
resource "neon_endpoint" "stage" {
  project_id               = var.project_id
  branch_id                = restapi_object.stage_branch.id
  type                     = "read_write"
  autoscaling_limit_min_cu = 0.25
  autoscaling_limit_max_cu = 1
  suspend_timeout_seconds  = 0
  lifecycle { prevent_destroy = true }
}
resource "neon_role" "stage" {
  project_id = var.project_id
  branch_id  = restapi_object.stage_branch.id
  name       = "quorem_stage_owner"
  lifecycle { prevent_destroy = true }
}
resource "neon_database" "stage" {
  project_id = var.project_id
  branch_id  = restapi_object.stage_branch.id
  name       = "quorem_hono_stage"
  owner_name = neon_role.stage.name
  lifecycle { prevent_destroy = true }
}
output "project_id" { value = var.project_id }
output "branch_id" { value = restapi_object.stage_branch.id }
output "database_url" {
  value = format(
    "postgresql://%s:%s@%s/%s?sslmode=verify-full",
    replace(urlencode(neon_role.stage.name), "+", "%20"),
    replace(urlencode(neon_role.stage.password), "+", "%20"),
    neon_endpoint.stage.host,
    neon_database.stage.name,
  )
  sensitive = true
}
