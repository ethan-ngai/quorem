terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  backend "s3" {}
  required_providers {
    neon       = { source = "kislerdm/neon", version = "0.18.0" }
    cloudflare = { source = "cloudflare/cloudflare", version = "5.28.1" }
  }
}

variable "account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "A Cloudflare account ID is required."
  }
}
variable "region" {
  type    = string
  default = "aws-us-east-1"
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

provider "neon" {}
provider "cloudflare" {}

# This creates a new root branch; it never references or clones the production project.
resource "neon_project" "stage" {
  name      = "quorem-hono-stage"
  region_id = var.region
  branch {
    name          = "stage"
    database_name = "quorem_hono_stage"
    role_name     = "quorem_stage_owner"
  }
  primary_compute {
    autoscaling_limit_min_cu = 0.25
    autoscaling_limit_max_cu = 1
    suspend_timeout_seconds  = 0
  }
  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zero_trust_access_service_token" "stage" {
  for_each   = toset(["runner_api", "verifier_api", "drain", "verifier", "case", "image"])
  account_id = var.account_id
  name       = "quorem-hono-stage-${replace(each.key, "_", "-")}"
  duration   = "8760h"
}

output "database_url" {
  value = format(
    "postgresql://%s:%s@%s/%s?sslmode=verify-full",
    replace(urlencode(neon_project.stage.database_user), "+", "%20"),
    replace(urlencode(neon_project.stage.database_password), "+", "%20"),
    neon_project.stage.database_host,
    neon_project.stage.database_name,
  )
  sensitive = true
}
output "access_tokens" {
  value = {
    for purpose, token in cloudflare_zero_trust_access_service_token.stage : purpose => {
      id            = token.id
      client_id     = token.client_id
      client_secret = token.client_secret
    }
  }
  sensitive = true
}
