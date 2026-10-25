"""Bootstrap the R2 backend through Terraform, then initialize durable stacks."""
import json
import os
from pathlib import Path
import subprocess
import sys
from cloudflare_api import get

root = Path(__file__).resolve().parent.parent
account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
bucket = os.environ.get("TF_STATE_BUCKET") or f"quorem-tfstate-{account[:12]}"
os.environ["TF_VAR_account_id"] = account
os.environ["TF_VAR_bucket_name"] = bucket
config = root / ".local/deploy/backend.hcl"
config.parent.mkdir(parents=True, exist_ok=True)
config.write_text(f'''bucket = {json.dumps(bucket)}
region = "auto"
endpoints = {{ s3 = "https://{account}.r2.cloudflarestorage.com" }}
skip_credentials_validation = true
skip_region_validation = true
skip_requesting_account_id = true
skip_metadata_api_check = true
skip_s3_checksum = true
use_lockfile = true
''')


def terraform(stack, *arguments):
    return subprocess.run(["terraform", f"-chdir=infra/terraform/{stack}", *arguments],
                          cwd=root, check=True)


if "--app-only" in sys.argv:
    terraform("app", "init", "-input=false", f"-backend-config={config}",
              "-backend-config=key=app/terraform.tfstate")
    raise SystemExit(0)

exists = get(f"/accounts/{account}/r2/buckets/{bucket}", missing_ok=True) is not None

override = root / "infra/terraform/state/backend.override.tf"
if exists:
    override.write_text('terraform {\n  backend "s3" {}\n}\n')
    cached = root / "infra/terraform/state/.terraform/terraform.tfstate"
    backend = json.loads(cached.read_text()).get("backend", {}).get("type") if cached.exists() else None
    migration = ["-migrate-state", "-force-copy"] if backend != "s3" and (root / "infra/terraform/state/terraform.tfstate").exists() else []
    terraform("state", "init", "-input=false", *migration, f"-backend-config={config}",
              "-backend-config=key=bootstrap/terraform.tfstate")
    state = subprocess.run(["terraform", "-chdir=infra/terraform/state", "state", "list"],
                           cwd=root, check=True, capture_output=True, text=True).stdout
    if "cloudflare_r2_bucket.state" not in state:
        terraform("state", "import", "-input=false", "cloudflare_r2_bucket.state", f"{account}/{bucket}/default")
else:
    terraform("state", "init", "-input=false")
terraform("state", "apply", "-input=false", "-auto-approve")
if not exists:
    override.write_text('terraform {\n  backend "s3" {}\n}\n')
    terraform("state", "init", "-input=false", "-migrate-state", "-force-copy",
              f"-backend-config={config}", "-backend-config=key=bootstrap/terraform.tfstate")
for stack in ("database", "app"):
    terraform(stack, "init", "-input=false", f"-backend-config={config}",
              f"-backend-config=key={stack}/terraform.tfstate")
