mock_provider "cloudflare" {
  mock_resource "cloudflare_hyperdrive_config" {
    defaults = { id = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
  }
}

variables {
  account_id                = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  worker_name               = "quorem-hono-stage"
  database_host             = "db-stage.example.com"
  database_port             = 5432
  database_name             = "quorem_stage"
  database_user             = "fixture"
  database_password         = "fixture-only"
  database_connection_limit = 10
  stage_hostname            = "stage.example.com"
  access_service_token_ids  = ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]
}

run "bootstrap_without_consumer" {
  command = plan
  assert {
    condition     = cloudflare_hyperdrive_config.database.origin.database == "quorem_stage" && cloudflare_hyperdrive_config.database.origin.scheme == "postgres" && cloudflare_hyperdrive_config.database.caching.disabled && cloudflare_hyperdrive_config.database.mtls.sslmode == "require" && cloudflare_hyperdrive_config.database.origin_connection_limit == 10
    error_message = "Hyperdrive must use the staged PostgreSQL origin with TLS, bounded connections and no query cache."
  }
  assert {
    condition     = length(cloudflare_queue_consumer.execution) == 0 && length(cloudflare_r2_bucket.profile) == 0
    error_message = "The queue consumer must wait until the staged Worker is deployed."
  }
  assert {
    condition     = cloudflare_worker.api.name == "quorem-hono-stage" && cloudflare_worker.api.subdomain.enabled == false
    error_message = "The staged Worker must be isolated and have no workers.dev route."
  }
  assert {
    condition     = cloudflare_queue.execution.queue_name == "quorem-hono-stage-execution" && cloudflare_queue.dead_letter.queue_name == "quorem-hono-stage-dead-letter"
    error_message = "Queues must be scoped to the staged Worker."
  }
  assert {
    condition     = cloudflare_zero_trust_access_application.internal.domain == "stage.example.com/internal/*" && cloudflare_zero_trust_access_policy.internal.decision == "non_identity" && one(cloudflare_zero_trust_access_policy.internal.include).service_token.token_id == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    error_message = "The complete internal path requires an explicit service token policy."
  }
}

run "attach_consumer_after_deployment" {
  command = plan
  variables { enable_queue_consumer = true }
  assert {
    condition     = length(cloudflare_queue_consumer.execution) == 1 && cloudflare_queue_consumer.execution[0].settings.batch_size == 1 && cloudflare_queue_consumer.execution[0].settings.max_concurrency == 1 && cloudflare_queue_consumer.execution[0].settings.max_wait_time_ms == 1000
    error_message = "The bounded consumer must attach to the stage queue."
  }
}

run "reject_live_worker_name" {
  command = plan
  variables { worker_name = "quorem-production" }
  expect_failures = [var.worker_name]
}

run "reject_missing_database_host" {
  command = plan
  variables { database_host = "" }
  expect_failures = [var.database_host]
}

run "reject_missing_access_identity" {
  command = plan
  variables { access_service_token_ids = [] }
  expect_failures = [var.access_service_token_ids]
}

run "reject_production_hostname" {
  command = plan
  variables { stage_hostname = "api.example.com" }
  expect_failures = [var.stage_hostname]
}

run "reject_unbounded_connections" {
  command = plan
  variables { database_connection_limit = 101 }
  expect_failures = [var.database_connection_limit]
}

run "reject_empty_database_password" {
  command = plan
  variables { database_password = "" }
  expect_failures = [var.database_password]
}

run "bind_provisioned_hyperdrive" {
  command = apply
  assert {
    condition     = output.hyperdrive_id == cloudflare_hyperdrive_config.database.id && output.hyperdrive_id == "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    error_message = "Generated bindings must use the provisioned Hyperdrive ID."
  }
}

run "optional_profile_bucket" {
  command = plan
  variables { profile_media_enabled = true }
  assert {
    condition     = length(cloudflare_r2_bucket.profile) == 1 && cloudflare_r2_bucket.profile[0].name == "quorem-hono-stage-profile"
    error_message = "Enabled media requires a fresh staged bucket."
  }
}



run "reject_stage_substring_in_live_label" {
  command = plan
  variables { stage_hostname = "productionstage.example.com" }
  expect_failures = [var.stage_hostname]
}
