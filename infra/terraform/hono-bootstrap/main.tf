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

data "neon_branches" "existing" { project_id = var.project_id }

locals { primary_branches = [for branch in data.neon_branches.existing.branches : branch.id if branch.primary] }

# Schema-only creates an independent root and requires compute in the same request.
resource "restapi_object" "stage_branch" {
  path = "/projects/${var.project_id}/branches"
  data = jsonencode({
    branch    = { name = "quorem-hono-stage", init_source = "schema-only", parent_id = length(local.primary_branches) == 1 ? local.primary_branches[0] : null }
    endpoints = [{ type = "read_write", autoscaling_limit_min_cu = 0.25, autoscaling_limit_max_cu = 1, suspend_timeout_seconds = 0 }]
  })
  ignore_all_server_changes = true
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [data]
    precondition {
      condition     = length(local.primary_branches) == 1
      error_message = "Exactly one primary Neon branch is required."
    }
    postcondition {
      condition = length(jsondecode(self.create_response).endpoints) == 1 && alltrue([for endpoint in jsondecode(self.create_response).endpoints :
        endpoint.type == "read_write" && endpoint.autoscaling_limit_min_cu == 0.25 && endpoint.autoscaling_limit_max_cu == 1 && endpoint.suspend_timeout_seconds == 0
      ])
      error_message = "The stage must be created with exactly one bounded read-write endpoint."
    }
  }
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
    one(jsondecode(restapi_object.stage_branch.create_response).endpoints).host,
    neon_database.stage.name,
  )
  sensitive = true
}
