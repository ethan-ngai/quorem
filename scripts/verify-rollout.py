"""Wait for the exact Terraform rollout before probing application readiness."""
import os
import subprocess
import time

from cloudflare_api import get


def output(name):
    return subprocess.check_output([
        "terraform", "-chdir=infra/terraform/app", "output", "-raw", name,
    ], text=True).strip()


application = output("application_id")
rollout = output("rollout_id")
path = f"/accounts/{os.environ['CLOUDFLARE_ACCOUNT_ID']}/containers/applications/{application}"
deadline = time.monotonic() + 480
print("Waiting for the Terraform rollout to replace its prior runtime...", flush=True)
while time.monotonic() < deadline:
    state = get(path + "/rollouts/" + rollout)
    if state["status"] in ("failed", "cancelled", "replaced"):
        raise SystemExit("Target rollout did not complete: " + state["status"])
    if state["status"] == "completed":
        if get(path)["configuration"]["image"] != os.environ["TF_VAR_image"]:
            raise SystemExit("Active image differs from the Terraform target")
        print("Target rollout completed; checking application readiness next.")
        break
    time.sleep(5)
else:
    raise SystemExit("Target rollout timed out")
