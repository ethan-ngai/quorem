terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "5.28.1" }
  }
}
variable "account_id" { type = string }
variable "bucket_name" { type = string }
provider "cloudflare" {}
resource "cloudflare_r2_bucket" "state" {
  account_id = var.account_id
  name       = var.bucket_name
  lifecycle { prevent_destroy = true }
}
