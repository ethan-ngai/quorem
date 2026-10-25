"""Reuse completed checks only when the tested application tree is unchanged."""
import json
import os
import subprocess

previous = os.environ.get("VALIDATED_RUN_ID", "")
reuse = False
reuse_image = False
image_sha = os.environ.get("GITHUB_SHA", "HEAD")
repository = os.environ["GITHUB_REPOSITORY"]
inputs = ["apps", "packages", "internal", "fixtures", "go.mod", "go.sum",
          "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", ".node-version",
          "vite.config.*", "scripts/build-site.mjs", "scripts/package-auth.py",
          "scripts/build-judge-images.py", "deploy"]
if previous.isdigit():
    try:
        run = json.loads(subprocess.check_output([
            "gh", "api", f"repos/{repository}/actions/runs/{previous}",
        ], text=True))
        jobs = json.loads(subprocess.check_output([
            "gh", "api", f"repos/{repository}/actions/runs/{previous}/jobs",
        ], text=True))["jobs"]
        passed = any(step["name"] == "Validate application and judge" and step["conclusion"] == "success"
                     for job in jobs for step in job.get("steps", []))
        reuse = passed and run["head_branch"] == "main" and subprocess.run([
            "git", "diff", "--quiet", run["head_sha"], "HEAD", "--", *inputs,
        ]).returncode == 0
    except (subprocess.CalledProcessError, KeyError, ValueError):
        reuse = False
published = os.environ.get("PUBLISHED_IMAGE_RUN_ID", "")
if published.isdigit():
    try:
        run = json.loads(subprocess.check_output(["gh", "api", f"repos/{repository}/actions/runs/{published}"], text=True))
        jobs = json.loads(subprocess.check_output(["gh", "api", f"repos/{repository}/actions/runs/{published}/jobs"], text=True))["jobs"]
        required = {"Build application image", "Verify nested Docker isolation", "Push application image"}
        verified = any(job["conclusion"] == "success" and required.issubset({
            step["name"] for step in job.get("steps", []) if step["conclusion"] == "success"
        }) for job in jobs)
        image_inputs = [path for path in inputs if path != "deploy"] + ["deploy/Dockerfile", "deploy/start.py", "deploy/nginx.conf"]
        reuse_image = verified and run["head_branch"] == "main" and subprocess.run([
            "git", "diff", "--quiet", run["head_sha"], "HEAD", "--", *image_inputs,
        ]).returncode == 0
        if reuse_image:
            image_sha = run["head_sha"]
    except (subprocess.CalledProcessError, KeyError, ValueError):
        reuse_image = False
with open(os.environ["GITHUB_OUTPUT"], "a") as output:
    output.write(f"reuse={'true' if reuse else 'false'}\n")
    output.write(f"reuse_image={'true' if reuse_image else 'false'}\nimage_sha={image_sha}\n")
if reuse_image:
    print(f"Container inputs unchanged; reusing published, sandbox-verified image {image_sha}.")
if reuse:
    print(f"Application tree unchanged; reusing successful checks from run {previous}.")
else:
    print("Running complete application and judge checks.")
