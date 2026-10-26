terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  backend "s3" {}
  required_providers {
    neon = { source = "kislerdm/neon", version = "0.18.0" }
  }
}
variable "project_name" {
  type    = string
  default = "quorem-production"
}
variable "region" {
  type    = string
  default = "aws-us-east-1"
}
variable "max_compute_cu" {
  type    = number
  default = 4
  validation {
    condition     = var.max_compute_cu >= 0.25 && var.max_compute_cu <= 16
    error_message = "Database compute must remain between 0.25 and 16 CU."
  }
}
provider "neon" {}
resource "neon_project" "production" {
  name      = var.project_name
  region_id = var.region
  branch {
    name          = "production"
    database_name = "quorem"
    role_name     = "quorem_owner"
  }
  primary_compute {
    autoscaling_limit_min_cu = 0.25
    autoscaling_limit_max_cu = var.max_compute_cu
    # Zero uses Neon's default five-minute suspension; account policies may reject overrides.
    suspend_timeout_seconds  = 0
  }
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [branch, history_retention_seconds]
  }
}
output "database_url" {
  value     = neon_project.production.connection_uri
  sensitive = true
}
