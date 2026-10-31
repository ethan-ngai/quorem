# Isolated Hono stage bootstrap

This stack uses the supplied existing Neon project. It creates a separate schema-only root branch from the default branch, an independent 0.25–1 CU compute, and a new empty `quorem_hono_stage` database owned by `quorem_stage_owner`. It does not change the default branch or copy its data. Neon schema-only branching is beta and subject to project limits; hosted permissions and compute readiness require validation.

The branch is created through Neon's API because the pinned Neon provider does not expose `init_source`. Terraform pins its returned branch ID and prevents destruction. If branch creation succeeds but its acknowledgement is lost, inspect the project and Terraform state before retrying; creation is not idempotent. Server-side changes are ignored by the REST provider, so refresh alone does not verify branch provenance.

`database_url` and `stage_secrets` are sensitive outputs. The URL uses `sslmode=verify-full`. The existing credential record is retained unchanged on later applies; rotation requires a separate procedure. State and plans contain secrets: use the separately keyed, encrypted, access-restricted bootstrap backend. No Cloudflare Access resources are provisioned.

For local validation, run `terraform init -backend=false`, `terraform validate`, `terraform test`, and `TERRAFORM_BIN=/path/to/terraform node --test tests/rest-identity.test.mjs`. The last test uses a loopback fixture to exercise the REST provider's create and refresh behavior. These checks do not call Neon or prove hosted behavior.
