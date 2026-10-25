terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  backend "s3" {}
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "5.28.1" }
    restapi    = { source = "Mastercard/restapi", version = "~> 2.0" }
    external   = { source = "hashicorp/external", version = "2.3.5" }
  }
}
variable "account_id" { type = string }
variable "zone_id" { type = string }
variable "domain" { type = string }
variable "image" { type = string }
variable "worker_name" {
  type    = string
  default = "quorem-production"
}
variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}
variable "database_url" {
  type      = string
  sensitive = true
}
variable "better_auth_secret" {
  type      = string
  sensitive = true
}
variable "auth_internal_secret" {
  type      = string
  sensitive = true
}
variable "invite_key" {
  type      = string
  sensitive = true
}
provider "cloudflare" {}
provider "restapi" {
  uri                  = "https://api.cloudflare.com/client/v4"
  write_returns_object = true
  id_attribute         = "result/id"
  headers = {
    "Content-Type"  = "application/json"
    "Authorization" = "Bearer ${var.cloudflare_api_token}"
  }
}
locals {
  origin = "https://${var.domain}"
  container_configuration = {
    image         = var.image
    instance_type = "standard-2"
    observability = { logs = { enabled = true } }
  }
  runtime = {
    AUTH_ORIGIN          = local.origin
    DATABASE_URL         = var.database_url
    AUTH_DATABASE_URL    = var.database_url
    BETTER_AUTH_SECRET   = var.better_auth_secret
    AUTH_INTERNAL_SECRET = var.auth_internal_secret
    QUOREM_INVITE_KEY    = var.invite_key
  }
}
resource "cloudflare_worker" "app" {
  account_id    = var.account_id
  name          = var.worker_name
  subdomain     = { enabled = false, previews_enabled = false }
  observability = { enabled = true }
}
resource "cloudflare_worker_version" "app" {
  account_id         = var.account_id
  worker_id          = cloudflare_worker.app.id
  compatibility_date = "2026-10-25"
  main_module        = "worker.js"
  modules = [{
    name           = "worker.js"
    content_type   = "application/javascript+module"
    content_base64 = filebase64("${path.module}/../../../deploy/worker.js")
  }]
  containers = [{ class_name = "Quorem" }]
  # Provider 5.28.1 cannot serialize exports; deploy the migration before attaching compute.
  migrations = {
    old_tag            = data.external.worker_migration.result.tag
    new_tag            = "v1"
    new_sqlite_classes = data.external.worker_migration.result.tag == "" ? ["Quorem"] : []
  }
  deploy = true
  lifecycle { create_before_destroy = true }
  bindings = [
    { type = "durable_object_namespace", name = "QUOREM", class_name = "Quorem" },
    { type = "plain_text", name = "APP_ORIGIN", text = local.origin },
    { type = "secret_text", name = "RUNTIME_ENV", text = jsonencode(local.runtime) },
  ]
}
data "external" "worker_migration" {
  program = ["python3", "${path.module}/../../../scripts/worker-migration-tag.py"]
  query = {
    account_id  = var.account_id
    script_name = var.worker_name
  }
  depends_on = [cloudflare_worker.app]
}
# The native Cloudflare provider lacks the application resource; Terraform still owns CRUD/state.
resource "restapi_object" "container" {
  path                      = "/accounts/${var.account_id}/containers/applications"
  update_method             = "PATCH"
  ignore_all_server_changes = true
  data = jsonencode({
    name              = var.worker_name
    scheduling_policy = "default"
    observability     = { logs = { enabled = true } }
    instances         = 0
    max_instances     = 1
    configuration     = local.container_configuration
    durable_objects   = { script_name = var.worker_name, class_name = "Quorem" }
  })
  update_data = jsonencode({ configuration = local.container_configuration, observability = { logs = { enabled = true } } })
  depends_on  = [cloudflare_worker_version.app]
}
resource "restapi_object" "rollout" {
  path                      = "/accounts/${var.account_id}/containers/applications/${restapi_object.container.id}/rollouts"
  ignore_all_server_changes = true
  force_new                 = [sha256(jsonencode(local.container_configuration))]
  lifecycle { create_before_destroy = true }
  # Rollouts are immutable events; retain their history when Terraform retires a state entry.
  destroy_method = "GET"
  data = jsonencode({
    description          = "Terraform application deployment"
    strategy             = "rolling"
    kind                 = "full_auto"
    target_configuration = local.container_configuration
    step_percentage      = 100
  })
}
resource "cloudflare_workers_custom_domain" "app" {
  account_id = var.account_id
  hostname   = var.domain
  zone_id    = var.zone_id
  service    = var.worker_name
  depends_on = [restapi_object.rollout]
}
output "origin" { value = local.origin }
