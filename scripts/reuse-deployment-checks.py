"""Reuse completed checks only when the tested application tree is unchanged."""
import json
import os
import subprocess

previous = os.environ.get("VALIDATED_RUN_ID", "")
reuse = False
reuse_image = False
patch_image = False
base_sha = ""
image_sha = os.environ.get("GITHUB_SHA", "HEAD")
repository = os.environ["GITHUB_REPOSITORY"]
inputs = ["apps", "packages", "internal", "fixtures", "go.mod", "go.sum",
          "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", ".node-version",
          "vite.config.*", "scripts/build-site.mjs", "scripts/package-auth.py",
          "scripts/build-judge-images.py"]
# Admission has focused policy tests and probes in the actual runtime image.
probe_exclusions = [":(exclude)apps/runner/internal/engine/preflight.go",
                    ":(exclude)apps/runner/internal/engine/preflight_test.go"]
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
            "git", "diff", "--quiet", run["head_sha"], "HEAD", "--", *inputs, *probe_exclusions,
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
        image_inputs = inputs + ["deploy/Dockerfile", "deploy/start.py", "deploy/nginx.conf"]
        reuse_image = reuse and verified and run["head_branch"] == "main" and subprocess.run([
            "git", "diff", "--quiet", run["head_sha"], "HEAD", "--", *image_inputs,
        ]).returncode == 0
        patch_image = not reuse_image and verified and run["head_branch"] == "main" and subprocess.run([
            "git", "diff", "--quiet", run["head_sha"], "HEAD", "--", *image_inputs, *probe_exclusions,
        ]).returncode == 0
        if patch_image:
            base_sha = run["head_sha"]
        if reuse_image:
            image_sha = run["head_sha"]
    except (subprocess.CalledProcessError, KeyError, ValueError):
        reuse_image = False
with open(os.environ["GITHUB_OUTPUT"], "a") as output:
    output.write(f"reuse={'true' if reuse else 'false'}\n")
    output.write(f"patch_image={str(patch_image).lower()}\nbase_sha={base_sha}\n")
    output.write(f"reuse_image={'true' if reuse_image else 'false'}\nimage_sha={image_sha}\n")
if patch_image:
    print(f"Only admission probe changed; patching verified image {base_sha} with the rebuilt runner.")
if reuse_image:
    print(f"Container inputs unchanged; reusing published, sandbox-verified image {image_sha}.")
if reuse:
    print(f"Application code unchanged; admission policy checked separately; reusing successful checks from run {previous}.")
else:
    print("Running complete application and judge checks.")
