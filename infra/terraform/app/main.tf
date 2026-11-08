terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  backend "s3" {}
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "5.28.1" }
  }
}

variable "account_id" { type = string }
variable "zone_id" { type = string }
variable "domain" { type = string }

provider "cloudflare" {}

resource "cloudflare_pages_project" "frontend" {
  account_id        = var.account_id
  name              = "quorem-frontend"
  production_branch = "main"
}
resource "cloudflare_dns_record" "frontend" {
  zone_id = var.zone_id
  name    = var.domain
  type    = "CNAME"
  content = cloudflare_pages_project.frontend.subdomain
  proxied = true
  ttl     = 1
}
resource "cloudflare_pages_domain" "frontend" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.frontend.name
  name         = var.domain
  depends_on   = [cloudflare_dns_record.frontend]
}
resource "cloudflare_workers_route" "api" {
  for_each = toset(["/v1/*", "/api/auth/*", "/health*", "/internal*"])
  zone_id  = var.zone_id
  pattern  = "${var.domain}${each.value}"
  script   = "quorem-hono-production"
}
output "frontend_project" { value = cloudflare_pages_project.frontend.name }
output "frontend_url" { value = "https://${cloudflare_pages_project.frontend.subdomain}" }
