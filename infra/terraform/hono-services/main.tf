terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  backend "s3" {}
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "5.28.1" }
    restapi    = { source = "Mastercard/restapi", version = "~> 2.0" }
    external   = { source = "hashicorp/external", version = "2.3.5" }
  }
}
variable "deployment_scope" {
  type    = string
  default = "stage"
  validation {
    condition     = contains(["stage", "production"], var.deployment_scope)
    error_message = "Select an explicit deployment scope."
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
    condition     = var.deployment_scope == "production" ? var.worker_name == "quorem-hono-services-production" : can(regex("^[a-z][a-z0-9-]*-hono-services-stage$", var.worker_name))
    error_message = "Use an isolated staged service Worker name."
  }
}
variable "hostnames" {
  type = object({ drain = string, verifier = string, case = string })
  validation {
    condition     = length(toset(values(var.hostnames))) == 3 && alltrue([for h in values(var.hostnames) : var.deployment_scope == "production" ? contains(["runner-hono.quorem.app", "verifier-hono.quorem.app", "case-hono.quorem.app"], h) : can(regex("^[a-z0-9-]*stag(e|ing)[a-z0-9-]*\\.[a-z0-9.-]+$", h))])
    error_message = "Three distinct staged hostnames are required."
  }
}
variable "release_sha" {
  type = string
  validation {
    condition     = can(regex("^[a-f0-9]{40}$", var.release_sha))
    error_message = "Supply the immutable release commit."
  }
}
variable "release_generation" {
  type    = number
  default = 1
  validation {
    condition     = var.release_generation >= 1 && floor(var.release_generation) == var.release_generation && var.release_generation < 9007199254740991
    error_message = "Supply a positive safe release generation."
  }
}
variable "profile_media_enabled" {
  type    = bool
  default = false
}
variable "image_hostname" {
  type    = string
  default = ""
  validation {
    condition     = !var.profile_media_enabled || ((var.deployment_scope == "production" ? var.image_hostname == "image-hono.quorem.app" : can(regex("^[a-z0-9-]*stag(e|ing)[a-z0-9-]*\\.[a-z0-9.-]+$", var.image_hostname))) && !contains(values(var.hostnames), var.image_hostname) && var.command_origin != "https://${var.image_hostname}" && var.source_origin != "https://${var.image_hostname}")
    error_message = "Image service needs a distinct staged hostname."
  }
}
variable "image_service_image" {
  type    = string
  default = ""
  validation {
    condition     = !var.profile_media_enabled || (startswith(var.image_service_image, "registry.cloudflare.com/${var.account_id}/") && can(regex("@sha256:[0-9a-f]{64}$", var.image_service_image)))
    error_message = "Image service must use an account-local digest-pinned image."
  }
}
variable "mail_relay_enabled" {
  type    = bool
  default = false
}
variable "mail_relay_hostname" {
  type    = string
  default = ""
  validation {
    condition     = !var.mail_relay_enabled || (var.deployment_scope == "production" && var.mail_relay_hostname == "mail-hono.quorem.app" && !contains(values(var.hostnames), var.mail_relay_hostname))
    error_message = "Mail relay requires its distinct production hostname."
  }
}
variable "mail_relay_image" {
  type    = string
  default = ""
  validation {
    condition     = !var.mail_relay_enabled || (startswith(var.mail_relay_image, "registry.cloudflare.com/${var.account_id}/") && can(regex("@sha256:[0-9a-f]{64}$", var.mail_relay_image)))
    error_message = "Mail relay requires an account-local digest."
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
    condition     = alltrue([for k in ["RECOVERY_CONTROL_SECRET", "QUOREM_RUNNER_COMMAND_SECRET", "QUOREM_RUNNER_DRAIN_SECRET", "QUOREM_CASE_SECRET", "QUOREM_VERIFICATION_SOURCE_KEY", "QUOREM_VERIFICATION_SERVICE_KEY", "QUOREM_CASE_OWNER_PUBLIC_KEY_PEM", "QUOREM_VERIFICATION_SIGNING_KEY_PEM", "CASE_OWNER_PRIVATE_KEY"] : try(length(var.service_secrets[k]) > 0, false)])
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
    "deploy/hono/services/case-control.js"   = "../../../deploy/hono/services/case-control.js"
    "deploy/hono/services/runner-control.js" = "../../../deploy/hono/services/runner-control.js"
    "deploy/hono/services/control-http.js"   = "../../../deploy/hono/services/control-http.js"
    "deploy/hono/services/worker.js"         = "../../../deploy/hono/services/worker.js"
    "deploy/container.js"                    = "../../../deploy/container.js"
    "deploy/policy.js"                       = "../../../deploy/policy.js"
    "deploy/case-service.js"                 = "../../../deploy/case-service.js"
    "deploy/case-proof.js"                   = "../../../deploy/case-proof.js"
    "deploy/case-sandbox.js"                 = "../../../deploy/case-sandbox.js"
  }
  service_hosts   = merge(var.hostnames, var.profile_media_enabled ? { image = var.image_hostname } : {}, var.mail_relay_enabled ? { mail = var.mail_relay_hostname } : {})
  secret_names    = concat(var.mail_relay_enabled ? ["MAIL_RELAY_TOKEN", "SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "AUTH_EMAIL_FROM"] : [], var.profile_media_enabled ? ["IMAGE_SERVICE_TOKEN"] : [], ["RECOVERY_CONTROL_SECRET", "QUOREM_RUNNER_COMMAND_SECRET", "QUOREM_RUNNER_DRAIN_SECRET", "QUOREM_CASE_SECRET", "QUOREM_VERIFICATION_SOURCE_KEY", "QUOREM_VERIFICATION_SERVICE_KEY", "QUOREM_CASE_OWNER_PUBLIC_KEY_PEM", "QUOREM_VERIFICATION_SIGNING_KEY_PEM", "CASE_OWNER_PRIVATE_KEY"])
  prior_tag       = data.external.worker_migration.result.tag
  control_classes = ["CaseControl", "RunnerReleaseControl"]
  base_classes    = local.prior_tag == "" ? concat(["RunnerService", "VerifierService", "CaseSandbox"], local.control_classes, var.profile_media_enabled ? ["ImageService"] : []) : local.prior_tag == "v1" ? concat(local.control_classes, var.profile_media_enabled ? ["ImageService"] : []) : local.prior_tag == "v2" ? local.control_classes : contains(["v3", "v5"], local.prior_tag) && var.profile_media_enabled ? ["ImageService"] : []
  new_classes     = concat(local.base_classes, var.mail_relay_enabled && !contains(["v5", "v6"], local.prior_tag) ? ["MailRelayService"] : [])
  base_tag        = var.profile_media_enabled || contains(["v2", "v4"], local.prior_tag) ? "v4" : "v3"
  target_tag      = var.mail_relay_enabled || contains(["v5", "v6"], local.prior_tag) ? (var.profile_media_enabled || local.prior_tag == "v6" ? "v6" : "v5") : local.base_tag
  control_digest = sha256(jsonencode({
    release        = var.release_sha
    generation     = var.release_generation
    namespace      = var.case_namespace_id
    command_origin = var.command_origin
    source_origin  = var.source_origin
    images         = merge(var.case_images, { runner = var.runner_image, verifier = var.verifier_image, image = var.profile_media_enabled ? var.image_service_image : "", mail = var.mail_relay_enabled ? var.mail_relay_image : "" })
    secrets        = nonsensitive(sha256(jsonencode({ for name in local.secret_names : name => var.service_secrets[name] })))
    modules        = { for name, source in local.modules : name => filesha256("${path.module}/${source}") }
  }))
  public = {
    SERVICES_RELEASE                  = var.release_sha
    SERVICES_GENERATION               = tostring(var.release_generation)
    SERVICES_BINDINGS                 = local.control_digest
    MAIL_RELAY_ENABLED                = tostring(var.mail_relay_enabled)
    MAIL_RELAY_ORIGIN                 = var.mail_relay_enabled ? "https://${var.mail_relay_hostname}" : ""
    IMAGE_SERVICE_ENABLED             = tostring(var.profile_media_enabled)
    IMAGE_ORIGIN                      = var.profile_media_enabled ? "https://${var.image_hostname}" : ""
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
    [{ type = "durable_object_namespace", name = "CASE_CONTROL", class_name = "CaseControl" }, { type = "durable_object_namespace", name = "RUNNER_CONTROL", class_name = "RunnerReleaseControl" }, { type = "durable_object_namespace", name = "RUNNERS", class_name = "RunnerService" }, { type = "durable_object_namespace", name = "VERIFIERS", class_name = "VerifierService" }, { type = "durable_object_namespace", name = "CASES", class_name = "CaseSandbox" }],
    var.profile_media_enabled ? [{ type = "durable_object_namespace", name = "IMAGES", class_name = "ImageService" }] : [],
    var.mail_relay_enabled ? [{ type = "durable_object_namespace", name = "MAIL", class_name = "MailRelayService" }] : [],
    [for k, v in local.public : { type = "plain_text", name = k, text = v }],
    [for k in local.secret_names : { type = "secret_text", name = k, text = var.service_secrets[k] }]
  )
  trusted = merge(var.mail_relay_enabled ? { mail = { class = "MailRelayService", image = var.mail_relay_image } } : {}, { runner = { class = "RunnerService", image = var.runner_image }, verifier = { class = "VerifierService", image = var.verifier_image } }, var.profile_media_enabled ? { image = { class = "ImageService", image = var.image_service_image } } : {})
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
  containers         = concat([{ class_name = "RunnerService" }, { class_name = "VerifierService" }, { class_name = "CaseSandbox" }], var.profile_media_enabled ? [{ class_name = "ImageService" }] : [], var.mail_relay_enabled ? [{ class_name = "MailRelayService" }] : [])
  migrations         = length(local.new_classes) > 0 ? { old_tag = local.prior_tag, new_tag = local.target_tag, new_sqlite_classes = local.new_classes } : null
  deploy             = true
  lifecycle {
    precondition {
      condition     = contains(["", "v1", "v2", "v3", "v4", "v5", "v6"], data.external.worker_migration.result.tag)
      error_message = "Unknown staged Worker migration history; refuse deployment."
    }
    precondition {
      condition     = try(length(var.service_secrets["RECOVERY_CONTROL_SECRET"]) >= 32 && !can(regex("\\s", var.service_secrets["RECOVERY_CONTROL_SECRET"])) && !contains([for name in local.secret_names : name == "RECOVERY_CONTROL_SECRET" ? "" : var.service_secrets[name]], var.service_secrets["RECOVERY_CONTROL_SECRET"]), false)
      error_message = "Recovery authority requires a distinct strong bearer."
    }
    precondition {
      condition     = !var.profile_media_enabled || try(length(var.service_secrets["IMAGE_SERVICE_TOKEN"]) >= 32 && !can(regex("\\s", var.service_secrets["IMAGE_SERVICE_TOKEN"])) && !contains([for k in local.secret_names : k == "IMAGE_SERVICE_TOKEN" ? "" : var.service_secrets[k]], var.service_secrets["IMAGE_SERVICE_TOKEN"]), false)
      error_message = "Image service requires a distinct strong bearer."
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
      QUOREM_WORKER_UPLOAD  = jsonencode({ worker = var.worker_name, deploy = true, modules = [for name, source in local.modules : { name = name, path = "${path.module}/${source}" }], metadata = { main_module = "deploy/hono/services/worker.js", compatibility_date = "2026-10-25", containers = concat([{ class_name = "RunnerService" }, { class_name = "VerifierService" }, { name = "${var.worker_name}-case", class_name = "CaseSandbox", images = var.case_images }], var.profile_media_enabled ? [{ class_name = "ImageService" }] : [], var.mail_relay_enabled ? [{ class_name = "MailRelayService" }] : []), bindings = local.bindings } })
    }
  }
  depends_on = [restapi_object.trusted_rollout, restapi_object.case]
}
resource "cloudflare_workers_custom_domain" "service" {
  for_each   = local.service_hosts
  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = each.value
  service    = cloudflare_worker.services.name
  depends_on = [terraform_data.case_images]
}
output "origins" { value = local.public }
