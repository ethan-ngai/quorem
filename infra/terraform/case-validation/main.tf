terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "5.28.1" }
    restapi    = { source = "Mastercard/restapi", version = "~> 2.0" }
    external   = { source = "hashicorp/external", version = "2.3.5" }
  }
}
variable "account_id" { type = string }
variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}
variable "validation_token" {
  type      = string
  sensitive = true
}
variable "name" {
  type = string
  validation {
    condition     = can(regex("^quorem-validation-[0-9]+$", var.name))
    error_message = "Validation resources require a unique run-scoped name."
  }
}
variable "image_prefix" {
  type    = string
  default = ""
  validation {
    condition     = var.image_prefix == "" || var.image_prefix == "quorem-case"
    error_message = "Image prefix must select production case images or run-scoped validation images."
  }
}
variable "image_revision" {
  type = string
  validation {
    condition     = can(regex("^[a-f0-9]{40}$", var.image_revision))
    error_message = "Validation images require a full commit SHA."
  }
}
provider "cloudflare" {}
provider "restapi" {
  uri                  = "https://api.cloudflare.com/client/v4"
  write_returns_object = true
  id_attribute         = "result/id"
  headers              = { "Content-Type" = "application/json", "Authorization" = "Bearer ${var.cloudflare_api_token}" }
}
data "external" "subdomain" {
  program = ["python3", "${path.module}/../../../scripts/worker-subdomain.py"]
  query   = { account_id = var.account_id }
}
locals {
  origin  = "https://${var.name}.${data.external.subdomain.result.name}.workers.dev"
  modules = ["worker.js", "router.js", "policy.js", "container.js", "case-sandbox.js"]
  bindings = [
    { type = "durable_object_namespace", name = "CASES", class_name = "CaseSandbox" },
    { type = "secret_text", name = "JUDGE_CONTROL_TOKEN", text = var.validation_token },
    { type = "plain_text", name = "APP_ORIGIN", text = local.origin },
  ]
  images = { for language in ["python", "java", "typescript", "ocaml", "postgresql"] : language => "registry.cloudflare.com/${var.account_id}/${var.image_prefix == "" ? var.name : var.image_prefix}-${language}:${var.image_revision}" }
}
resource "cloudflare_worker" "test" {
  account_id = var.account_id
  name       = var.name
  subdomain  = { enabled = true, previews_enabled = false }
}
resource "cloudflare_worker_version" "test" {
  account_id         = var.account_id
  worker_id          = cloudflare_worker.test.id
  compatibility_date = "2026-10-25"
  main_module        = "worker.js"
  modules            = [for name in local.modules : { name = name, content_type = "application/javascript+module", content_base64 = filebase64("${path.module}/../../../deploy/${name}") }]
  containers         = [{ class_name = "CaseSandbox" }]
  migrations         = { new_tag = "v1", new_sqlite_classes = ["CaseSandbox"] }
  bindings           = local.bindings
  deploy             = true
}
resource "restapi_object" "case" {
  path         = "/accounts/${var.account_id}/containers/applications"
  id_attribute = "result/id"
  data         = jsonencode({ name = var.name, scheduling_policy = "durable_object", durable_objects = { script_name = var.name, class_name = "CaseSandbox" } })
  depends_on   = [cloudflare_worker_version.test]
}
resource "terraform_data" "version" {
  triggers_replace = [cloudflare_worker_version.test.id, restapi_object.case.id, var.image_revision]
  provisioner "local-exec" {
    command = "python3 ${path.module}/../../../scripts/upload-worker-version.py"
    environment = {
      CLOUDFLARE_ACCOUNT_ID = var.account_id
      CLOUDFLARE_API_TOKEN  = var.cloudflare_api_token
      QUOREM_WORKER_UPLOAD = jsonencode({
        worker  = var.name
        deploy  = true
        modules = [for name in local.modules : { name = name, path = "${path.module}/../../../deploy/${name}" }]
        metadata = {
          main_module        = "worker.js"
          compatibility_date = "2026-10-25"
          containers         = [{ name = var.name, class_name = "CaseSandbox", images = local.images }]
          bindings           = local.bindings
        }
      })
    }
  }
}
output "origin" { value = local.origin }
