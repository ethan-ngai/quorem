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
variable "database_host" {
  type = string
  validation {
    condition     = can(regex("^[a-zA-Z0-9.-]+$", var.database_host)) && length(var.database_host) > 0
    error_message = "A database origin hostname is required."
  }
}
variable "database_port" {
  type = number
  validation {
    condition     = var.database_port >= 1 && var.database_port <= 65535 && floor(var.database_port) == var.database_port
    error_message = "A valid database origin port is required."
  }
}
variable "database_name" {
  type = string
  validation {
    condition     = length(trimspace(var.database_name)) > 0
    error_message = "A database name is required."
  }
}
variable "database_user" {
  type = string
  validation {
    condition     = length(trimspace(var.database_user)) > 0
    error_message = "A database user is required."
  }
}
variable "database_password" {
  type      = string
  sensitive = true
  validation {
    condition     = length(var.database_password) > 0
    error_message = "A database password is required."
  }
}
variable "database_connection_limit" {
  type = number
  validation {
    condition     = var.database_connection_limit >= 5 && var.database_connection_limit <= 100 && floor(var.database_connection_limit) == var.database_connection_limit
    error_message = "Set a database connection budget between 5 and 100."
  }
}

variable "stage_hostname" {
  type = string
  validation {
    condition     = can(regex("^([a-z0-9]+-)*stag(e|ing)(-[a-z0-9]+)*(\\.[a-z0-9-]+)+$", var.stage_hostname))
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
variable "enable_queue_consumer" {
  type    = bool
  default = false
}

resource "cloudflare_hyperdrive_config" "database" {
  account_id = var.account_id
  name       = "${var.worker_name}-database"
  origin = {
    scheme   = "postgres"
    host     = var.database_host
    port     = var.database_port
    database = var.database_name
    user     = var.database_user
    password = var.database_password
  }
  caching                 = { disabled = true }
  mtls                    = { sslmode = "require" }
  origin_connection_limit = var.database_connection_limit
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
output "hyperdrive_id" { value = cloudflare_hyperdrive_config.database.id }
output "queue_name" { value = cloudflare_queue.execution.queue_name }
output "dead_letter_queue_name" { value = cloudflare_queue.dead_letter.queue_name }

variable "profile_media_enabled" {
  type    = bool
  default = false
}

resource "cloudflare_r2_bucket" "profile" {
  count      = var.profile_media_enabled ? 1 : 0
  account_id = var.account_id
  name       = "${var.worker_name}-profile"
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = length("${var.worker_name}-profile") <= 63
      error_message = "The stage Worker name is too long for the profile bucket."
    }
  }
}

output "profile_bucket_name" {
  value = try(cloudflare_r2_bucket.profile[0].name, null)
}
