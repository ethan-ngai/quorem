"""Import an explicitly selected Neon project, then apply its protected configuration."""
import os
import subprocess

base = ["terraform", "-chdir=infra/terraform/database"]
project = os.environ.get("NEON_PROJECT_ID")
if project:
    state = subprocess.check_output([*base, "state", "list"], text=True).splitlines()
    if "neon_project.production" not in state:
        subprocess.run([*base, "import", "-input=false", "neon_project.production", project], check=True)
subprocess.run([*base, "apply", "-input=false", "-auto-approve"], check=True)
url = subprocess.check_output([*base, "output", "-raw", "database_url"], text=True).strip()
print("::add-mask::" + url)
with open(os.environ["GITHUB_ENV"], "a") as output:
    for name in ("DATABASE_URL", "AUTH_DATABASE_URL", "TF_VAR_database_url"):
        output.write(name + "=" + url + "\n")
