terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  backend "s3" {}
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "5.28.1" }
  }
}

variable "account_id" { type = string }
variable "worker_name" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]*-hono-stage$", var.worker_name))
    error_message = "Use a distinct staged Worker name ending in -hono-stage."
  }
}
variable "hyperdrive_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.hyperdrive_id))
    error_message = "A provisioned Hyperdrive configuration ID is required."
  }
}
variable "stage_hostname" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9-]*stag(e|ing)[a-z0-9-]*\\.[a-z0-9.-]+$", var.stage_hostname))
    error_message = "Use a distinct staged hostname."
  }
}
variable "access_service_token_ids" {
  type = set(string)
  validation {
    condition     = length(var.access_service_token_ids) > 0 && alltrue([for id in var.access_service_token_ids : can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", id))])
    error_message = "At least one existing Access service token ID is required."
  }
}
variable "drain_hostname" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9-]*stag(e|ing)[a-z0-9-]*\\.[a-z0-9.-]+$", var.drain_hostname)) && var.drain_hostname != var.stage_hostname
    error_message = "Use a distinct staged drain hostname."
  }
}
variable "drain_access_service_token_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.drain_access_service_token_id)) && !contains(var.access_service_token_ids, var.drain_access_service_token_id)
    error_message = "Use a distinct existing Access service token for the drain."
  }
}
variable "enable_queue_consumer" {
  type    = bool
  default = false
}

resource "cloudflare_worker" "api" {
  account_id    = var.account_id
  name          = var.worker_name
  subdomain     = { enabled = false, previews_enabled = false }
  observability = { enabled = true }
}

resource "cloudflare_zero_trust_access_policy" "internal" {
  account_id = var.account_id
  name       = "${var.worker_name}-internal-service"
  decision   = "non_identity"
  include    = [for id in var.access_service_token_ids : { service_token = { token_id = id } }]
}

resource "cloudflare_zero_trust_access_application" "internal" {
  account_id = var.account_id
  name       = "${var.worker_name}-internal"
  type       = "self_hosted"
  domain     = "${var.stage_hostname}/internal/*"
  destinations = [{
    type = "public"
    uri  = "${var.stage_hostname}/internal/*"
  }]
  policies                  = [{ id = cloudflare_zero_trust_access_policy.internal.id, precedence = 1 }]
  app_launcher_visible      = false
  service_auth_401_redirect = false
}

resource "cloudflare_zero_trust_access_policy" "drain" {
  account_id = var.account_id
  name       = "${var.worker_name}-drain-service"
  decision   = "non_identity"
  include    = [{ service_token = { token_id = var.drain_access_service_token_id } }]
}

resource "cloudflare_zero_trust_access_application" "drain" {
  account_id                = var.account_id
  name                      = "${var.worker_name}-drain"
  type                      = "self_hosted"
  domain                    = "${var.drain_hostname}/internal/drain"
  destinations              = [{ type = "public", uri = "${var.drain_hostname}/internal/drain" }]
  policies                  = [{ id = cloudflare_zero_trust_access_policy.drain.id, precedence = 1 }]
  app_launcher_visible      = false
  service_auth_401_redirect = false
}

resource "cloudflare_queue" "execution" {
  account_id = var.account_id
  queue_name = "${var.worker_name}-execution"
  settings   = { message_retention_period = 86400 }
}

resource "cloudflare_queue" "dead_letter" {
  account_id = var.account_id
  queue_name = "${var.worker_name}-dead-letter"
  settings   = { message_retention_period = 345600 }
}

# Create only after the staged Worker with its queue handler is deployed.
resource "cloudflare_queue_consumer" "execution" {
  count             = var.enable_queue_consumer ? 1 : 0
  account_id        = var.account_id
  queue_id          = cloudflare_queue.execution.id
  script_name       = cloudflare_worker.api.name
  type              = "worker"
  dead_letter_queue = cloudflare_queue.dead_letter.queue_name
  settings = {
    batch_size       = 1
    max_wait_time_ms = 1000
    max_retries      = 5
    retry_delay      = 10
    max_concurrency  = 1
  }
}

output "worker_name" { value = cloudflare_worker.api.name }
output "stage_hostname" { value = var.stage_hostname }
output "internal_access_application_id" { value = cloudflare_zero_trust_access_application.internal.id }
output "drain_hostname" { value = var.drain_hostname }
output "drain_access_application_id" { value = cloudflare_zero_trust_access_application.drain.id }
output "hyperdrive_id" { value = var.hyperdrive_id }
output "queue_name" { value = cloudflare_queue.execution.queue_name }
output "dead_letter_queue_name" { value = cloudflare_queue.dead_letter.queue_name }
