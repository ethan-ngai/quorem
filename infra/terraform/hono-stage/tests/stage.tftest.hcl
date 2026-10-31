mock_provider "cloudflare" {}

variables {
  account_id                    = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  worker_name                   = "quorem-hono-stage"
  hyperdrive_id                 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  stage_hostname                = "stage.example.com"
  access_service_token_ids      = ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]
  drain_hostname                = "runner-stage.example.com"
  drain_access_service_token_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
}

run "bootstrap_without_consumer" {
  command = plan
  assert {
    condition     = length(cloudflare_queue_consumer.execution) == 0
    error_message = "The queue consumer must wait until the staged Worker is deployed."
  }
  assert {
    condition     = cloudflare_zero_trust_access_application.drain.domain == "runner-stage.example.com/internal/drain" && one(cloudflare_zero_trust_access_policy.drain.include).service_token.token_id == "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    error_message = "Drain access needs its own explicit service token."
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

run "reject_missing_hyperdrive" {
  command = plan
  variables { hyperdrive_id = "placeholder" }
  expect_failures = [var.hyperdrive_id]
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
