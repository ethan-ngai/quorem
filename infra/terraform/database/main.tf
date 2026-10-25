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
    autoscaling_limit_max_cu = 1
    suspend_timeout_seconds  = 300
  }
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [branch, primary_compute, history_retention_seconds]
  }
}
output "database_url" {
  value     = neon_project.production.connection_uri
  sensitive = true
}
