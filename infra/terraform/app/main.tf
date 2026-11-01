terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  backend "s3" {}
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "5.28.1" }
    restapi    = { source = "Mastercard/restapi", version = "~> 2.0" }
    external   = { source = "hashicorp/external", version = "2.3.5" }
    random     = { source = "hashicorp/random", version = "3.7.2" }
  }
}
variable "account_id" { type = string }
variable "zone_id" { type = string }
variable "domain" { type = string }
variable "api_worker_name" {
  type    = string
  default = ""
}
variable "image" { type = string }
variable "judge_image" { type = string }
variable "case_image_revision" { type = string }
variable "api_lossless_results" {
  type    = bool
  default = false
}
variable "judge_lossless_results" {
  type    = bool
  default = false
}
variable "judge_lossless_cases" {
  type    = bool
  default = false
  validation {
    condition     = !var.judge_lossless_cases || var.judge_lossless_results
    error_message = "Lossless judge cases require lossless judge result writes."
  }
}
variable "api_lossless_cases" {
  type    = bool
  default = false
  validation {
    condition     = !var.api_lossless_cases || (var.api_lossless_results && var.judge_lossless_cases && var.judge_lossless_results)
    error_message = "Lossless API cases require lossless API results and capable judges."
  }
}
variable "judge_resumable_execution" {
  type    = bool
  default = false
}
variable "app_pool_shards" {
  type    = number
  default = 4
  validation {
    condition     = var.app_pool_shards >= 1 && var.app_pool_shards <= 16 && floor(var.app_pool_shards) == var.app_pool_shards
    error_message = "Capacity must be a bounded positive integer."
  }
}
variable "app_instances_per_shard" {
  type    = number
  default = 2
  validation {
    condition     = var.app_instances_per_shard >= 1 && var.app_instances_per_shard <= 8 && floor(var.app_instances_per_shard) == var.app_instances_per_shard
    error_message = "Capacity must be a bounded positive integer."
  }
}
variable "judge_max_instances" {
  type    = number
  default = 8
  validation {
    condition     = var.judge_max_instances >= 1 && var.judge_max_instances <= 8 && floor(var.judge_max_instances) == var.judge_max_instances
    error_message = "Capacity must be a bounded positive integer."
  }
}
variable "app_http_capacity" {
  type    = number
  default = 32
  validation {
    condition     = var.app_http_capacity >= 1 && var.app_http_capacity <= 256 && floor(var.app_http_capacity) == var.app_http_capacity
    error_message = "Capacity must be a bounded positive integer."
  }
}
variable "app_ws_capacity" {
  type    = number
  default = 512
  validation {
    condition     = var.app_ws_capacity >= 1 && var.app_ws_capacity <= 2048 && floor(var.app_ws_capacity) == var.app_ws_capacity
    error_message = "Capacity must be a bounded positive integer."
  }
}
variable "app_vcpu" {
  type    = number
  default = 1
  validation {
    condition     = var.app_vcpu >= 1 && var.app_vcpu <= 4 && floor(var.app_vcpu) == var.app_vcpu
    error_message = "Capacity must be a bounded positive integer."
  }
}
variable "app_memory_mib" {
  type    = number
  default = 3072
  validation {
    condition     = var.app_memory_mib >= 3072 * var.app_vcpu && var.app_memory_mib <= 16384 && floor(var.app_memory_mib) == var.app_memory_mib
    error_message = "Memory must be an integer from 3 GiB per vCPU to 16 GiB."
  }
}
variable "judge_vcpu" {
  type    = number
  default = 2
  validation {
    condition     = var.judge_vcpu >= 1 && var.judge_vcpu <= 4 && floor(var.judge_vcpu) == var.judge_vcpu
    error_message = "Capacity must be a bounded positive integer."
  }
}
variable "judge_memory_mib" {
  type    = number
  default = 6144
  validation {
    condition     = var.judge_memory_mib >= 3072 * var.judge_vcpu && var.judge_memory_mib <= 12288 && floor(var.judge_memory_mib) == var.judge_memory_mib
    error_message = "Judge memory must be an integer from 3 GiB per vCPU to 12 GiB."
  }
}
variable "judge_idle_ms" {
  type    = number
  default = 120000
  validation {
    condition     = var.judge_idle_ms >= 15000 && var.judge_idle_ms <= 600000
    error_message = "Judge idle grace must be between 15 seconds and ten minutes."
  }
}
variable "worker_name" {
  type    = string
  default = "quorem-production"
}
variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}
variable "database_url" {
  type      = string
  sensitive = true
}
variable "better_auth_secret" {
  type      = string
  sensitive = true
}
variable "auth_internal_secret" {
  type      = string
  sensitive = true
}
variable "invite_key" {
  type      = string
  sensitive = true
}
variable "guest_creation_enabled" {
  type    = bool
  default = true
}
variable "guest_admission_enabled" {
  type    = bool
  default = true
}
variable "guest_execution_enabled" {
  type    = bool
  default = true
}
variable "auth_environment" {
  type      = map(string)
  sensitive = true
  default   = {}
  validation {
    condition = alltrue([for key in keys(var.auth_environment) : contains([
      "AUTH_MODE", "AUTH_LOGIN_ONLY", "AUTH_EMAIL_DRIVER", "AUTH_EMAIL_FROM",
      "AUTH_EMAIL_SES_REGION", "AUTH_EMAIL_CLOUDFLARE_ACCOUNT_ID", "AUTH_EMAIL_CLOUDFLARE_API_TOKEN",
      "COGNITO_CLIENT_ID", "COGNITO_CLIENT_SECRET", "COGNITO_DOMAIN", "COGNITO_REGION", "COGNITO_USERPOOL_ID",
      "SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD",
      "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET"
    ], key)])
    error_message = "Only auth provider settings belong in auth_environment."
  }
}
variable "auth_public_config" {
  type = object({
    method          = string
    hostedSignIn    = optional(bool)
    preferredOrigin = string
    passkey         = bool
    registration    = bool
    providers       = list(string)
  })
  default = null
}
provider "cloudflare" {}
provider "restapi" {
  uri                  = "https://api.cloudflare.com/client/v4"
  write_returns_object = true
  id_attribute         = "result/id"
  headers = {
    "Content-Type"  = "application/json"
    "Authorization" = "Bearer ${var.cloudflare_api_token}"
  }
}
resource "random_password" "judge_control" {
  length  = 64
  special = false
}
locals {
  origin = "https://${var.domain}"
  container_configuration = {
    image      = var.image
    vcpu       = var.app_vcpu
    memory_mib = var.app_memory_mib
    disk       = { size_mb = 4000 }
  }
  judge_configuration = {
    image                 = var.judge_image
    vcpu                  = var.judge_vcpu
    memory_mib            = var.judge_memory_mib
    disk                  = { size_mb = 20000 }
    environment_variables = [{ name = "QUOREM_RUNTIME_REVISION", value = nonsensitive(sha256(jsonencode(local.judge_runtime))) }]
  }
  runtime = merge({
    AUTH_ORIGIN                      = local.origin
    DATABASE_URL                     = var.database_url
    AUTH_DATABASE_URL                = var.database_url
    AUTH_MODE                        = "password"
    AUTH_PASSWORD_PRODUCTION         = "true"
    AUTH_LOGIN_ONLY                  = "true"
    BETTER_AUTH_SECRET               = var.better_auth_secret
    AUTH_INTERNAL_SECRET             = var.auth_internal_secret
    QUOREM_INVITE_KEY                = var.invite_key
    GUEST_CREATION_ENABLED           = tostring(var.guest_creation_enabled)
    GUEST_ADMISSION_ENABLED          = tostring(var.guest_admission_enabled)
    GUEST_EXECUTION_ENABLED          = tostring(var.guest_execution_enabled)
    QUOREM_REALTIME_PROVIDER         = "postgres-notify"
    QUOREM_SKIP_MIGRATIONS           = "true"
    QUOREM_DATABASE_MAX_CONNS        = "4"
    QUOREM_LOSSLESS_CASES            = tostring(var.api_lossless_cases)
    QUOREM_LOSSLESS_RESULT_WRITES    = tostring(var.api_lossless_results)
    AUTH_DATABASE_MAX_CONNS          = "4"
    QUOREM_API_MAX_REQUESTS          = tostring(var.app_http_capacity)
    QUOREM_REALTIME_CONNECTION_LIMIT = tostring(var.app_ws_capacity)
    QUOREM_REQUIRE_EXECUTION_WAKE    = "true"
    QUOREM_DELIVERY_PROVIDER         = "cloudflare-dispatch"
    QUOREM_EXECUTION_WAKE_URL        = "${local.origin}/internal/judge/wake"
    QUOREM_JUDGE_CONTROL_TOKEN       = random_password.judge_control.result
  }, var.auth_environment)
  judge_runtime = {
    DATABASE_URL                  = var.database_url
    QUOREM_DATABASE_MAX_CONNS     = "2"
    QUOREM_LOSSLESS_CASES         = tostring(var.judge_lossless_cases)
    QUOREM_LOSSLESS_RESULT_WRITES = tostring(var.judge_lossless_results)
    QUOREM_RESUMABLE_EXECUTION    = tostring(var.judge_resumable_execution)
    QUOREM_JUDGE_CONTROL_TOKEN    = random_password.judge_control.result
    RUNNER_ADDR                   = "0.0.0.0:8090"
    RUNNER_CONCURRENCY            = "2"
    QUOREM_CASE_SANDBOX_ORIGIN    = local.origin
  }
}
resource "cloudflare_queue" "judge" {
  account_id = var.account_id
  queue_name = "${var.worker_name}-judge-wake"
  settings   = { message_retention_period = 86400 }
}
resource "cloudflare_queue" "judge_dead_letter" {
  account_id = var.account_id
  queue_name = "${var.worker_name}-judge-dead-letter"
  settings   = { message_retention_period = 345600 }
}

resource "cloudflare_worker" "app" {
  account_id    = var.account_id
  name          = var.worker_name
  subdomain     = { enabled = false, previews_enabled = false }
  observability = { enabled = true }
}
locals {
  worker_bindings = [
    { type = "durable_object_namespace", name = "APPS", class_name = "Quorem" },
    { type = "durable_object_namespace", name = "POOLS", class_name = "AppPool" },
    { type = "durable_object_namespace", name = "JUDGES", class_name = "Judge" },
    { type = "durable_object_namespace", name = "FAST_JUDGES", class_name = "FastJudge" },
    { type = "durable_object_namespace", name = "CASES", class_name = "CaseSandbox" },
    { type = "queue", name = "JUDGE_WAKE", queue_name = cloudflare_queue.judge.queue_name },
    { type = "secret_text", name = "JUDGE_CONTROL_TOKEN", text = random_password.judge_control.result },
    { type = "secret_text", name = "APP_RUNTIME_ENV", text = jsonencode(local.runtime) },
    { type = "plain_text", name = "APP_RUNTIME_REVISION", text = nonsensitive(sha256(jsonencode(local.runtime))) },
    { type = "secret_text", name = "JUDGE_RUNTIME_ENV", text = jsonencode(local.judge_runtime) },
    { type = "plain_text", name = "AUTH_PUBLIC_CONFIG", text = jsonencode(var.auth_public_config) },
    { type = "plain_text", name = "APP_POOL_SHARDS", text = tostring(var.app_pool_shards) },
    { type = "plain_text", name = "APP_INSTANCES_PER_SHARD", text = tostring(var.app_instances_per_shard) },
    { type = "plain_text", name = "APP_HTTP_CAPACITY", text = tostring(var.app_http_capacity) },
    { type = "plain_text", name = "APP_WS_CAPACITY", text = tostring(var.app_ws_capacity) },
    { type = "plain_text", name = "JUDGE_MAX_INSTANCES", text = tostring(var.judge_max_instances) },
    { type = "plain_text", name = "JUDGE_IDLE_MS", text = tostring(var.judge_idle_ms) },
    { type = "plain_text", name = "APP_LOCATION_HINT", text = "enam" },
    { type = "plain_text", name = "APP_ORIGIN", text = local.origin },
  ]
}
resource "cloudflare_worker_version" "app" {
  account_id         = var.account_id
  worker_id          = cloudflare_worker.app.id
  compatibility_date = "2026-10-25"
  main_module        = "worker.js"
  modules = [for name in ["worker.js", "router.js", "policy.js", "container.js", "case-sandbox.js", "case-service.js", "case-proof.js"] : {
    name           = name
    content_type   = "application/javascript+module"
    content_base64 = filebase64("${path.module}/../../../deploy/${name}")
  }]
  containers = [{ class_name = "Quorem" }, { class_name = "Judge" }, { class_name = "FastJudge" }, { class_name = "CaseSandbox" }]
  # Provider 5.28.1 cannot serialize exports; deploy the migration before attaching compute.
  migrations = {
    old_tag            = data.external.worker_migration.result.tag
    new_tag            = "v4"
    new_sqlite_classes = data.external.worker_migration.result.tag == "" ? ["Quorem", "AppPool", "Judge", "FastJudge", "CaseSandbox"] : (data.external.worker_migration.result.tag == "v1" ? ["AppPool", "Judge", "FastJudge", "CaseSandbox"] : (data.external.worker_migration.result.tag == "v2" ? ["FastJudge", "CaseSandbox"] : (data.external.worker_migration.result.tag == "v3" ? ["CaseSandbox"] : [])))
  }
  deploy = true
  lifecycle { create_before_destroy = true }
  bindings = local.worker_bindings
}
data "external" "worker_migration" {
  program = ["python3", "${path.module}/../../../scripts/worker-migration-tag.py"]
  query = {
    account_id  = var.account_id
    script_name = var.worker_name
  }
  depends_on = [cloudflare_worker.app]
}
# The native Cloudflare provider lacks the application resource; Terraform still owns CRUD/state.
resource "restapi_object" "container" {
  path                      = "/accounts/${var.account_id}/containers/applications"
  update_method             = "PATCH"
  ignore_all_server_changes = true
  data = jsonencode({
    name              = var.worker_name
    scheduling_policy = "default"
    constraints       = { regions = ["ENAM"] }
    observability     = { logs = { enabled = true } }
    instances         = 0
    # Leave room for the prior runtime while its connections drain.
    max_instances   = 2 * var.app_pool_shards * var.app_instances_per_shard
    configuration   = local.container_configuration
    durable_objects = { script_name = var.worker_name, class_name = "Quorem" }
  })
  update_data = jsonencode({ constraints = { regions = ["ENAM"] }, max_instances = 2 * var.app_pool_shards * var.app_instances_per_shard, configuration = local.container_configuration, observability = { logs = { enabled = true } } })
  depends_on  = [cloudflare_worker_version.app]
}
resource "restapi_object" "rollout" {
  path                      = "/accounts/${var.account_id}/containers/applications/${restapi_object.container.id}/rollouts"
  ignore_all_server_changes = true
  force_new                 = [sha256(jsonencode(local.container_configuration))]
  lifecycle { create_before_destroy = true }
  # Rollouts are immutable events; retain their history when Terraform retires a state entry.
  destroy_method = "GET"
  data = jsonencode({
    description          = "Terraform application deployment"
    strategy             = "rolling"
    kind                 = "full_auto"
    target_configuration = local.container_configuration
    step_percentage      = 100
  })
}
resource "restapi_object" "judge_container" {
  path                      = "/accounts/${var.account_id}/containers/applications"
  update_method             = "PATCH"
  ignore_all_server_changes = true
  data = jsonencode({
    name              = "${var.worker_name}-judge"
    scheduling_policy = "default"
    constraints       = { regions = ["ENAM"] }
    observability     = { logs = { enabled = true } }
    instances         = 0
    max_instances     = var.judge_max_instances
    configuration     = local.judge_configuration
    durable_objects   = { script_name = var.worker_name, class_name = "Judge" }
  })
  update_data = jsonencode({ constraints = { regions = ["ENAM"] }, max_instances = var.judge_max_instances, configuration = local.judge_configuration, observability = { logs = { enabled = true } } })
  depends_on  = [cloudflare_worker_version.app]
  lifecycle { ignore_changes = [data, update_data] }
}
resource "restapi_object" "judge_rollout" {
  path                      = "/accounts/${var.account_id}/containers/applications/${restapi_object.judge_container.id}/rollouts"
  ignore_all_server_changes = true
  force_new                 = [sha256(jsonencode(local.judge_configuration))]
  lifecycle {
    create_before_destroy = true
    ignore_changes        = [data, force_new]
  }
  destroy_method = "GET"
  data = jsonencode({
    description          = "Terraform judge deployment"
    strategy             = "rolling"
    kind                 = "full_auto"
    target_configuration = local.judge_configuration
    step_percentage      = 100
  })
}
resource "restapi_object" "fast_judge_container" {
  path                      = "/accounts/${var.account_id}/containers/applications"
  update_method             = "PATCH"
  ignore_all_server_changes = true
  data = jsonencode({
    name              = "${var.worker_name}-judge-fast"
    scheduling_policy = "durable_object"
    observability     = { logs = { enabled = true } }
    durable_objects   = { script_name = var.worker_name, class_name = "FastJudge" }
  })
  update_data = jsonencode({ observability = { logs = { enabled = true } } })
  depends_on  = [cloudflare_worker_version.app]
}

resource "restapi_object" "case_container" {
  path                      = "/accounts/${var.account_id}/containers/applications"
  update_method             = "PATCH"
  ignore_all_server_changes = true
  data = jsonencode({
    name              = "${var.worker_name}-case"
    scheduling_policy = "durable_object"
    observability     = { logs = { enabled = true } }
    durable_objects   = { script_name = var.worker_name, class_name = "CaseSandbox" }
  })
  update_data = jsonencode({ observability = { logs = { enabled = true } } })
  depends_on  = [cloudflare_worker_version.app]
}

locals {
  fast_worker_config = {
    worker = var.worker_name
    deploy = true
    modules = [for name in ["worker.js", "router.js", "policy.js", "container.js", "case-sandbox.js", "case-service.js", "case-proof.js"] : {
      name = name
      path = "${path.module}/../../../deploy/${name}"
    }]
    metadata = {
      main_module        = "worker.js"
      compatibility_date = "2026-10-25"
      containers = [
        { class_name = "Quorem" },
        { class_name = "Judge" },
        { name = "${var.worker_name}-judge-fast", class_name = "FastJudge", images = { judge = var.judge_image } },
        { name = "${var.worker_name}-case", class_name = "CaseSandbox", images = { for language in ["python", "java", "typescript", "ocaml", "postgresql"] : language => "registry.cloudflare.com/${var.account_id}/quorem-case-${language}:${var.case_image_revision}" } }
      ]
      bindings = concat(
        [for binding in local.worker_bindings : binding.name == "JUDGES" ? merge(binding, { class_name = "FastJudge" }) : binding],
        [
          { type = "plain_text", name = "JUDGE_VCPU", text = tostring(var.judge_vcpu) },
          { type = "plain_text", name = "JUDGE_MEMORY_MIB", text = tostring(var.judge_memory_mib) },
          { type = "plain_text", name = "JUDGE_FAST_REVISION", text = nonsensitive(sha256(jsonencode([var.judge_image, local.judge_runtime, var.judge_vcpu, var.judge_memory_mib]))) }
        ]
      )
    }
  }
}

# The provider omits named-image metadata; Terraform owns the upload and deploy step.
resource "terraform_data" "fast_worker_version" {
  triggers_replace = [
    cloudflare_worker_version.app.id,
    nonsensitive(sha256(jsonencode(local.fast_worker_config))),
    filesha256("${path.module}/../../../scripts/upload-worker-version.py")
  ]
  provisioner "local-exec" {
    command = "python3 ${path.module}/../../../scripts/upload-worker-version.py"
    environment = {
      CLOUDFLARE_ACCOUNT_ID = var.account_id
      CLOUDFLARE_API_TOKEN  = var.cloudflare_api_token
      QUOREM_WORKER_UPLOAD  = jsonencode(local.fast_worker_config)
    }
  }
  depends_on = [restapi_object.fast_judge_container, restapi_object.case_container, restapi_object.rollout, restapi_object.judge_rollout]
}
resource "cloudflare_queue_consumer" "judge" {
  account_id        = var.account_id
  queue_id          = cloudflare_queue.judge.id
  script_name       = var.worker_name
  type              = "worker"
  dead_letter_queue = cloudflare_queue.judge_dead_letter.queue_name
  settings = {
    batch_size       = 100
    max_concurrency  = var.judge_max_instances
    max_retries      = 20
    max_wait_time_ms = 0
    retry_delay      = 2
  }
  depends_on = [terraform_data.fast_worker_version]
}
output "runtime_rollouts" {
  value = {
    app   = { application_id = restapi_object.container.id, rollout_id = restapi_object.rollout.id, image = var.image }
    judge = { application_id = restapi_object.fast_judge_container.id, case_application_id = restapi_object.case_container.id, worker = var.worker_name, image = var.judge_image, case_revision = var.case_image_revision }
  }
}

output "origin" { value = local.origin }

output "application_id" { value = restapi_object.container.id }
output "rollout_id" { value = restapi_object.rollout.id }

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
  script   = var.api_worker_name != "" ? var.api_worker_name : var.worker_name
}
output "frontend_project" { value = cloudflare_pages_project.frontend.name }
output "frontend_url" { value = "https://${cloudflare_pages_project.frontend.subdomain}" }

output "judge_queue_id" {
  value = cloudflare_queue.judge.id
}
