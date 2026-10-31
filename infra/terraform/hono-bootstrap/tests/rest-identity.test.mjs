/** Exercise the real REST provider against a local Neon-shaped endpoint. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, mkdir, symlink, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

void test(
  "REST branch keeps its ID and produces no repeat-plan drift",
  { timeout: 60000 },
  async () => {
    const moduleRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const dir = await mkdtemp(join(tmpdir(), "quorem-neon-rest-"));
    const requests = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (part) => {
        body += part;
      });
      request.on("end", () => {
        requests.push({ method: request.method, url: request.url, body });
        if (
          request.method === "POST" &&
          request.url === "/api/v2/projects/existing-project-fixture/branches"
        ) {
          response.writeHead(201, { "content-type": "application/json" });
          response.end(
            JSON.stringify({ branch: { id: "br-stage-fixture", name: "quorem-hono-stage" } }),
          );
        } else if (
          request.method === "GET" &&
          request.url === "/api/v2/projects/existing-project-fixture/branches/br-stage-fixture"
        ) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              branch: {
                id: "br-stage-fixture",
                name: "quorem-hono-stage",
                parent_id: null,
                current_state: "ready",
              },
            }),
          );
        } else {
          response.writeHead(404).end();
        }
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = server.address().port;
    const secrets = Object.fromEntries(
      [
        "RECOVERY_CONTROL_SECRET",
        "QUOREM_RUNNER_COMMAND_SECRET",
        "QUOREM_RUNNER_DRAIN_SECRET",
        "QUOREM_CASE_SECRET",
        "QUOREM_VERIFICATION_SOURCE_KEY",
        "QUOREM_VERIFICATION_SERVICE_KEY",
        "IMAGE_SERVICE_TOKEN",
        "QUOREM_CASE_OWNER_PUBLIC_KEY_PEM",
        "CASE_OWNER_PRIVATE_KEY",
        "QUOREM_VERIFICATION_SIGNING_KEY_PEM",
        "VERIFICATION_PUBLIC_KEY",
        "MATCH_INVITE_KEY",
        "BETTER_AUTH_SECRET",
        "AUTH_INTERNAL_SECRET",
        "STAGE_RUNTIME_DATABASE_PASSWORD",
      ].map((key) => [key, "fixture-only"]),
    );
    const run = (args) =>
      new Promise((resolveRun, reject) => {
        const child = spawn(process.env.TERRAFORM_BIN ?? "terraform", [`-chdir=${dir}`, ...args], {
          env: {
            ...process.env,
            TF_VAR_project_id: "existing-project-fixture",
            TF_VAR_neon_api_key: "fixture-only",
            TF_VAR_stage_secrets: JSON.stringify(secrets),
            TF_IN_AUTOMATION: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (part) => {
          output += part;
        });
        child.stderr.on("data", (part) => {
          output += part;
        });
        child.on("error", reject);
        child.on("exit", (code) => resolveRun({ code, output }));
      });
    try {
      const source = await readFile(join(moduleRoot, "main.tf"), "utf8");
      const fixture = source
        .replace('backend "s3" {}', "")
        .replace(
          'data "neon_branches" "existing" { project_id = var.project_id }',
          'variable "fixture_primary" { default = "br-primary" }\nlocals { fixture_branches = [{ id = var.fixture_primary, primary = true }] }',
        )
        .replace("data.neon_branches.existing.branches", "local.fixture_branches")
        .replace("https://console.neon.tech/api/v2", `http://127.0.0.1:${port}/api/v2`);
      assert.ok(!fixture.includes('data "neon_branches"'));
      assert.ok(!fixture.includes("https://console.neon.tech"));
      await writeFile(join(dir, "main.tf"), fixture);
      await cp(join(moduleRoot, ".terraform.lock.hcl"), join(dir, ".terraform.lock.hcl"));
      await mkdir(join(dir, ".terraform"));
      await symlink(join(moduleRoot, ".terraform/providers"), join(dir, ".terraform/providers"));
      let result = await run(["init", "-backend=false", "-input=false"]);
      assert.equal(result.code, 0, result.output);
      result = await run([
        "apply",
        "-input=false",
        "-auto-approve",
        "-target=restapi_object.stage_branch",
      ]);
      assert.equal(result.code, 0, result.output);
      result = await run([
        "plan",
        "-input=false",
        "-detailed-exitcode",
        "-var=fixture_primary=br-new-primary",
        "-target=restapi_object.stage_branch",
      ]);
      assert.equal(result.code, 0, result.output);
      const post = requests.find((request) => request.method === "POST");
      assert.deepEqual(JSON.parse(post.body), {
        branch: { name: "quorem-hono-stage", init_source: "schema-only", parent_id: "br-primary" },
      });
      assert.ok(
        requests.some(
          (request) => request.method === "GET" && request.url.endsWith("/br-stage-fixture"),
        ),
      );
      assert.equal(requests.filter((request) => request.method === "POST").length, 1);
    } finally {
      await new Promise((done) => server.close(done));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
