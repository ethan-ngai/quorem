"""Reuse completed checks only when the tested application tree is unchanged."""
import json
import os
import subprocess

previous = os.environ.get("VALIDATED_RUN_ID", "")
reuse = False
if previous.isdigit():
    repository = os.environ["GITHUB_REPOSITORY"]
    try:
        run = json.loads(subprocess.check_output([
            "gh", "api", f"repos/{repository}/actions/runs/{previous}",
        ], text=True))
        jobs = json.loads(subprocess.check_output([
            "gh", "api", f"repos/{repository}/actions/runs/{previous}/jobs",
        ], text=True))["jobs"]
        passed = any(step["name"] == "Validate application and judge" and step["conclusion"] == "success"
                     for job in jobs for step in job.get("steps", []))
        inputs = ["apps", "packages", "internal", "fixtures", "go.mod", "go.sum",
                  "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", ".node-version",
                  "vite.config.*", "scripts/build-site.mjs", "scripts/package-auth.py",
                  "scripts/build-judge-images.py", "deploy"]
        reuse = passed and run["head_branch"] == "main" and subprocess.run([
            "git", "diff", "--quiet", run["head_sha"], "HEAD", "--", *inputs,
        ]).returncode == 0
    except (subprocess.CalledProcessError, KeyError, ValueError):
        reuse = False
with open(os.environ["GITHUB_OUTPUT"], "a") as output:
    output.write(f"reuse={'true' if reuse else 'false'}\n")
if reuse:
    print(f"Application tree unchanged; reusing successful checks from run {previous}.")
else:
    print("Running complete application and judge checks.")
