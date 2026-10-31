# Isolated Hono stage bootstrap

This stack creates a new Neon project and root branch with a dedicated `quorem_hono_stage` database and `quorem_stage_owner` migration role. It never references a production project or branch. The primary compute is limited to 0.25–1 CU and uses Neon's default autosuspend. The project and initial application-credential record have `prevent_destroy`.

It creates six distinct Cloudflare Access service tokens and exposes `database_url`, `access_tokens`, and `stage_secrets` as sensitive outputs. The direct Neon URL requests `sslmode=verify-full`. `stage_secrets` is written once and retained on subsequent applies; rotation requires a separate audited procedure. Token lifetime is one year. Both provider credentials and all output values require restricted handling; Terraform state and plans contain secrets despite sensitive output marking. Use the separately keyed, encrypted and access-restricted bootstrap backend. Do not import existing production resources.

Local validation uses `terraform init -backend=false`, `terraform validate`, and `terraform test` with mocked providers. These checks do not create cloud resources or prove actual Neon migration-role permissions, Cloudflare Access enforcement, or service reachability.
