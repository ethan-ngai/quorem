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
variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}
variable "worker_name" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]*-hono-services-stage$", var.worker_name))
    error_message = "Use an isolated staged service Worker name."
  }
}
variable "hostnames" {
  type = object({ drain = string, verifier = string, case = string })
  validation {
    condition     = length(toset(values(var.hostnames))) == 3 && alltrue([for h in values(var.hostnames) : can(regex("^[a-z0-9-]*stag(e|ing)[a-z0-9-]*\\.[a-z0-9.-]+$", h))])
    error_message = "Three distinct staged hostnames are required."
  }
}
variable "dns_target" { type = string }
variable "access_token_ids" {
  type = object({ drain = string, verifier = string, case = string })
  validation {
    condition     = length(toset(values(var.access_token_ids))) == 3 && alltrue([for id in values(var.access_token_ids) : can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", id))])
    error_message = "Each capability requires a distinct Access service token ID."
  }
}
variable "case_diagnostics" {
  type    = bool
  default = false
}
variable "runner_image" {
  type = string
  validation {
    condition     = startswith(var.runner_image, "registry.cloudflare.com/${var.account_id}/") && can(regex("@sha256:[0-9a-f]{64}$", var.runner_image))
    error_message = "Runner image must be an account-local digest-pinned image."
  }
}
variable "verifier_image" {
  type = string
  validation {
    condition     = startswith(var.verifier_image, "registry.cloudflare.com/${var.account_id}/") && can(regex("@sha256:[0-9a-f]{64}$", var.verifier_image))
    error_message = "Verifier image must be an account-local digest-pinned image."
  }
}
variable "case_images" {
  type = object({ python = string, java = string, typescript = string, ocaml = string, postgresql = string })
  validation {
    condition     = alltrue([for image in values(var.case_images) : startswith(image, "registry.cloudflare.com/${var.account_id}/") && can(regex("@sha256:[0-9a-f]{64}$", image))])
    error_message = "All case images must be account-local and digest-pinned."
  }
}
variable "command_origin" {
  type = string
  validation {
    condition     = can(regex("^https://[a-z0-9.-]+$", var.command_origin)) && !contains(values(var.hostnames), trimprefix(var.command_origin, "https://"))
    error_message = "Use a distinct HTTPS API command origin."
  }
}
variable "source_origin" {
  type = string
  validation {
    condition     = can(regex("^https://[a-z0-9.-]+$", var.source_origin)) && !contains(values(var.hostnames), trimprefix(var.source_origin, "https://"))
    error_message = "Use a distinct HTTPS API source origin."
  }
}
variable "case_namespace_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9a-f]{64}$", var.case_namespace_id))
    error_message = "Supply the actual staged CaseSandbox namespace sentinel."
  }
}
variable "service_secrets" {
  type      = map(string)
  sensitive = true
  validation {
    condition     = alltrue([for k in ["QUOREM_RUNNER_COMMAND_SECRET", "QUOREM_RUNNER_DRAIN_SECRET", "QUOREM_CASE_SECRET", "QUOREM_VERIFICATION_SOURCE_KEY", "QUOREM_VERIFICATION_SERVICE_KEY", "QUOREM_CASE_OWNER_PUBLIC_KEY_PEM", "QUOREM_VERIFICATION_SIGNING_KEY_PEM", "RUNNER_API_ACCESS_CLIENT_ID", "RUNNER_API_ACCESS_CLIENT_SECRET", "VERIFIER_API_ACCESS_CLIENT_ID", "VERIFIER_API_ACCESS_CLIENT_SECRET", "QUOREM_CASE_ACCESS_CLIENT_ID", "QUOREM_CASE_ACCESS_CLIENT_SECRET", "CASE_OWNER_PRIVATE_KEY"] : try(length(var.service_secrets[k]) > 0, false)])
    error_message = "All purpose-scoped service credentials and keys are required."
  }
}
provider "cloudflare" {}
provider "restapi" {
  uri                  = "https://api.cloudflare.com/client/v4"
  write_returns_object = true
  id_attribute         = "result/id"
  headers              = { "Content-Type" = "application/json", "Authorization" = "Bearer ${var.cloudflare_api_token}" }
}
locals {
  modules = {
    "deploy/hono/services/worker.js" = "../../../deploy/hono/services/worker.js"
    "deploy/container.js"            = "../../../deploy/container.js"
    "deploy/policy.js"               = "../../../deploy/policy.js"
    "deploy/case-service.js"         = "../../../deploy/case-service.js"
    "deploy/case-proof.js"           = "../../../deploy/case-proof.js"
    "deploy/case-sandbox.js"         = "../../../deploy/case-sandbox.js"
  }
  secret_names = ["QUOREM_RUNNER_COMMAND_SECRET", "QUOREM_RUNNER_DRAIN_SECRET", "QUOREM_CASE_SECRET", "QUOREM_VERIFICATION_SOURCE_KEY", "QUOREM_VERIFICATION_SERVICE_KEY", "QUOREM_CASE_OWNER_PUBLIC_KEY_PEM", "QUOREM_VERIFICATION_SIGNING_KEY_PEM", "RUNNER_API_ACCESS_CLIENT_ID", "RUNNER_API_ACCESS_CLIENT_SECRET", "VERIFIER_API_ACCESS_CLIENT_ID", "VERIFIER_API_ACCESS_CLIENT_SECRET", "QUOREM_CASE_ACCESS_CLIENT_ID", "QUOREM_CASE_ACCESS_CLIENT_SECRET", "CASE_OWNER_PRIVATE_KEY"]
  public = {
    CASE_DIAGNOSTICS                  = tostring(var.case_diagnostics)
    DRAIN_ORIGIN                      = "https://${var.hostnames.drain}"
    VERIFIER_ORIGIN                   = "https://${var.hostnames.verifier}"
    CASE_ORIGIN                       = "https://${var.hostnames.case}"
    QUOREM_CASE_ORIGIN                = "https://${var.hostnames.case}"
    QUOREM_RUNNER_COMMAND_ORIGIN      = var.command_origin
    QUOREM_VERIFICATION_SOURCE_ORIGIN = var.source_origin
    QUOREM_CASE_NAMESPACE_ID          = var.case_namespace_id
  }
  bindings = concat(
    [{ type = "durable_object_namespace", name = "RUNNERS", class_name = "RunnerService" }, { type = "durable_object_namespace", name = "VERIFIERS", class_name = "VerifierService" }, { type = "durable_object_namespace", name = "CASES", class_name = "CaseSandbox" }],
    [for k, v in local.public : { type = "plain_text", name = k, text = v }],
    [for k in local.secret_names : { type = "secret_text", name = k, text = var.service_secrets[k] }]
  )
  trusted = { runner = { class = "RunnerService", image = var.runner_image }, verifier = { class = "VerifierService", image = var.verifier_image } }
  paths   = { drain = "/internal/drain", verifier = "/internal/results/verify", case = "/internal/case/*" }
}
resource "cloudflare_worker" "services" {
  account_id = var.account_id
  name       = var.worker_name
  subdomain  = { enabled = false, previews_enabled = false }
}
resource "terraform_data" "case_namespace_pin" {
  count = var.case_namespace_id == "0000000000000000000000000000000000000000000000000000000000000000" ? 0 : 1
  input = var.case_namespace_id
  lifecycle {
    ignore_changes  = [input]
    prevent_destroy = true
  }
}

data "external" "worker_migration" {
  program = ["python3", "${path.module}/../../../scripts/worker-migration-tag.py"]
  query   = { account_id = var.account_id, script_name = var.worker_name }
}

resource "cloudflare_worker_version" "services" {
  account_id         = var.account_id
  worker_id          = cloudflare_worker.services.id
  compatibility_date = "2026-10-25"
  main_module        = "deploy/hono/services/worker.js"
  modules            = [for name, source in local.modules : { name = name, content_type = "application/javascript+module", content_base64 = filebase64("${path.module}/${source}") }]
  bindings           = local.bindings
  containers         = [{ class_name = "RunnerService" }, { class_name = "VerifierService" }, { class_name = "CaseSandbox" }]
  migrations         = data.external.worker_migration.result.tag == "" ? { old_tag = "", new_tag = "v1", new_sqlite_classes = ["RunnerService", "VerifierService", "CaseSandbox"] } : null
  deploy             = true
  lifecycle {
    precondition {
      condition     = contains(["", "v1"], data.external.worker_migration.result.tag)
      error_message = "Unknown staged Worker migration history; refuse deployment."
    }
    precondition {
      condition     = var.case_namespace_id == "0000000000000000000000000000000000000000000000000000000000000000" || try(terraform_data.case_namespace_pin[0].output == var.case_namespace_id, false)
      error_message = "The case namespace must match its immutable state pin."
    }
  }
}
resource "restapi_object" "trusted" {
  for_each                  = local.trusted
  path                      = "/accounts/${var.account_id}/containers/applications"
  update_method             = "PATCH"
  ignore_all_server_changes = true
  data                      = jsonencode({ name = "${var.worker_name}-${each.key}", scheduling_policy = "default", instances = 0, max_instances = 1, configuration = { image = each.value.image, vcpu = 1, memory_mib = 3072, disk = { size_mb = 4000 } }, durable_objects = { script_name = var.worker_name, class_name = each.value.class } })
  update_data               = jsonencode({ max_instances = 1, configuration = { image = each.value.image, vcpu = 1, memory_mib = 3072, disk = { size_mb = 4000 } } })
  depends_on                = [cloudflare_worker_version.services]
}
resource "restapi_object" "trusted_rollout" {
  for_each                  = local.trusted
  path                      = "/accounts/${var.account_id}/containers/applications/${restapi_object.trusted[each.key].id}/rollouts"
  ignore_all_server_changes = true
  destroy_method            = "GET"
  force_new                 = [sha256(each.value.image)]
  lifecycle { create_before_destroy = true }
  data = jsonencode({ description = "Staged private service deployment", strategy = "rolling", kind = "full_auto", target_configuration = { image = each.value.image, vcpu = 1, memory_mib = 3072, disk = { size_mb = 4000 } }, step_percentage = 100 })
}
resource "restapi_object" "case" {
  path                      = "/accounts/${var.account_id}/containers/applications"
  update_method             = "PATCH"
  ignore_all_server_changes = true
  data                      = jsonencode({ name = "${var.worker_name}-case", scheduling_policy = "durable_object", durable_objects = { script_name = var.worker_name, class_name = "CaseSandbox" } })
  update_data               = jsonencode({ observability = { logs = { enabled = true } } })
  depends_on                = [cloudflare_worker_version.services]
}
resource "terraform_data" "case_images" {
  triggers_replace = [cloudflare_worker_version.services.id, restapi_object.case.id, nonsensitive(sha256(jsonencode(var.case_images))), filesha256("${path.module}/../../../scripts/upload-worker-version.py")]
  provisioner "local-exec" {
    command = "python3 ${path.module}/../../../scripts/upload-worker-version.py"
    environment = {
      CLOUDFLARE_ACCOUNT_ID = var.account_id
      CLOUDFLARE_API_TOKEN  = var.cloudflare_api_token
      QUOREM_WORKER_UPLOAD  = jsonencode({ worker = var.worker_name, deploy = true, modules = [for name, source in local.modules : { name = name, path = "${path.module}/${source}" }], metadata = { main_module = "deploy/hono/services/worker.js", compatibility_date = "2026-10-25", containers = [{ class_name = "RunnerService" }, { class_name = "VerifierService" }, { name = "${var.worker_name}-case", class_name = "CaseSandbox", images = var.case_images }], bindings = local.bindings } })
    }
  }
  depends_on = [restapi_object.trusted_rollout, restapi_object.case]
}
resource "cloudflare_zero_trust_access_policy" "service" {
  for_each   = var.hostnames
  account_id = var.account_id
  name       = "${var.worker_name}-${each.key}"
  decision   = "non_identity"
  include    = [{ service_token = { token_id = var.access_token_ids[each.key] } }]
}
resource "cloudflare_zero_trust_access_application" "service" {
  for_each                  = var.hostnames
  account_id                = var.account_id
  name                      = "${var.worker_name}-${each.key}"
  type                      = "self_hosted"
  domain                    = "${each.value}${local.paths[each.key]}"
  destinations              = [{ type = "public", uri = "${each.value}${local.paths[each.key]}" }]
  policies                  = [{ id = cloudflare_zero_trust_access_policy.service[each.key].id, precedence = 1 }]
  app_launcher_visible      = false
  service_auth_401_redirect = false
}
resource "cloudflare_dns_record" "service" {
  for_each = var.hostnames
  zone_id  = var.zone_id
  name     = each.value
  type     = "CNAME"
  content  = var.dns_target
  proxied  = true
  ttl      = 1
}
resource "cloudflare_workers_route" "service" {
  for_each   = var.hostnames
  zone_id    = var.zone_id
  pattern    = "${each.value}/*"
  script     = cloudflare_worker.services.name
  depends_on = [cloudflare_dns_record.service, cloudflare_zero_trust_access_application.service, terraform_data.case_images]
}
output "origins" { value = local.public }
