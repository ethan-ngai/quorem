"""Verify both exact role rollouts and images before probing production routes."""
import json
import os
import subprocess
import time
from cloudflare_api import get

roles = json.loads(subprocess.check_output([
    "terraform", "-chdir=infra/terraform/app", "output", "-json", "runtime_rollouts",
], text=True))
if set(roles) != {"app", "judge"}:
    raise SystemExit("Both application and judge rollouts must be configured")
pending = dict(roles)
deadline = time.monotonic() + 480
while pending and time.monotonic() < deadline:
    for role, target in list(pending.items()):
        path = f"/accounts/{os.environ['CLOUDFLARE_ACCOUNT_ID']}/containers/applications/{target['application_id']}"
        state = get(path + "/rollouts/" + target["rollout_id"])
        if state["status"] in ("failed", "cancelled", "replaced"):
            raise SystemExit(role + " target rollout did not complete: " + state["status"])
        if state["status"] == "completed":
            if get(path)["configuration"]["image"] != target["image"]:
                raise SystemExit(role + " active image differs from Terraform target")
            print(role + " target rollout completed", flush=True)
            del pending[role]
    if pending:
        time.sleep(5)
if pending:
    raise SystemExit("Target rollouts timed out: " + ", ".join(pending))
