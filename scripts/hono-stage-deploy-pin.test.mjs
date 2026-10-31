import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

void test("the real namespace pin prevents change, bootstrap reset, destroy and rollback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorem-namespace-pin-"));
  try {
    const source = await readFile("infra/terraform/hono-services/main.tf", "utf8");
    const pin = source.match(/resource "terraform_data" "case_namespace_pin" \{[\s\S]*?\n\}/)?.[0];
    const precondition = source.match(
      /    precondition \{\n      condition\s+= var\.case_namespace_id[\s\S]*?\n    \}/,
    )?.[0];
    assert.ok(pin && precondition);
    await writeFile(
      join(dir, "main.tf"),
      `variable "case_namespace_id" { type = string }\n${pin}\nresource "terraform_data" "worker" {\n input = var.case_namespace_id\n lifecycle {\n${precondition}\n }\n}\n`,
    );
    const terraform = process.env.QUOREM_TERRAFORM_BIN || "terraform";
    const run = (command, namespace) =>
      spawnSync(
        terraform,
        [
          `-chdir=${dir}`,
          command,
          "-input=false",
          ...(command === "apply" ? ["-auto-approve"] : []),
          `-var=case_namespace_id=${namespace}`,
        ],
        { encoding: "utf8" },
      );
    execFileSync(terraform, [`-chdir=${dir}`, "init", "-backend=false", "-input=false"], {
      stdio: "pipe",
    });
    const zero = "0".repeat(64),
      first = "a".repeat(64),
      other = "b".repeat(64);
    assert.equal(run("apply", zero).status, 0);
    assert.equal(run("apply", first).status, 0);
    assert.equal(run("plan", first).status, 0);
    assert.notEqual(run("plan", other).status, 0);
    assert.notEqual(run("plan", zero).status, 0);
    assert.notEqual(run("destroy", first).status, 0);
    assert.equal(run("plan", first).status, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
