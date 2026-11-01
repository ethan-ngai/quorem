terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  backend "s3" {}
  required_providers {
    neon    = { source = "kislerdm/neon", version = "0.18.0" }
    restapi = { source = "Mastercard/restapi", version = "~> 2.0" }
  }
}
variable "project_id" { type = string }
variable "neon_api_key" {
  type      = string
  sensitive = true
}
variable "release_sha" { type = string }
variable "secrets" {
  type      = map(string)
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
locals { primary = [for branch in data.neon_branches.existing.branches : branch.id if branch.primary] }
# Retain a data snapshot before any production ledger or schema mutation.
resource "restapi_object" "backup" {
  path                      = "/projects/${var.project_id}/branches"
  data                      = jsonencode({ branch = { name = "hono-cutover-${substr(var.release_sha, 0, 12)}", parent_id = one(local.primary) } })
  ignore_all_server_changes = true
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [data]
    precondition {
      condition     = length(local.primary) == 1
      error_message = "Production backup requires one primary branch."
    }
  }
}
resource "terraform_data" "secrets" {
  input = var.secrets
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [input]
  }
}
output "secrets" {
  value     = terraform_data.secrets.output
  sensitive = true
}
output "backup_branch" { value = restapi_object.backup.id }
variable "phase" {
  type    = string
  default = "prepared"
}
resource "terraform_data" "activation" {
  input = { release = var.release_sha, phase = var.phase }
}
output "activation" { value = terraform_data.activation.output }
