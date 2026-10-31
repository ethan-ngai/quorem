import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { test } from "node:test";

const docker = (args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const keys = () => {
  const pair = generateKeyPairSync("ed25519");
  return {
    private: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    public: pair.publicKey.export({ type: "spki", format: "pem" }),
  };
};
async function waitHealth(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Private image health unavailable");
}
function start(kind, env, port) {
  const name = `quorem-35d-${kind}-${randomUUID()}`;
  const args = ["run", "-d", "--rm", "--name", name, "-p", `127.0.0.1::${port}`];
  for (const [key, value] of Object.entries(env)) args.push("-e", `${key}=${value}`);
  args.push("quorem-35d-private-fixture:local");
  docker(args);
  const mapping = docker(["port", name, `${port}/tcp`]);
  return { name, port: Number(mapping.slice(mapping.lastIndexOf(":") + 1)) };
}
test("staged image boots remote runner and separate verifier with private key files", async () => {
  const caseKey = keys(),
    verifyKey = keys(),
    running = [];
  try {
    const runner = start(
      "runner",
      {
        QUOREM_PRIVATE_SERVICE: "runner",
        QUOREM_SANDBOX_PROVIDER: "remote",
        QUOREM_RUNNER_MODE: "http",
        QUOREM_RUNNER_LISTEN: "0.0.0.0:8090",
        QUOREM_RUNNER_COMMAND_ORIGIN: "http://127.0.0.1:8080",
        QUOREM_RUNNER_COMMAND_SECRET: "a".repeat(64),
        QUOREM_RUNNER_DRAIN_SECRET: "b".repeat(64),
        QUOREM_CASE_ORIGIN: "http://127.0.0.1:8081",
        QUOREM_CASE_SECRET: "c".repeat(64),
        QUOREM_CASE_NAMESPACE_ID: "1".repeat(64),
        QUOREM_CASE_OWNER_PUBLIC_KEY_PEM: caseKey.public,
      },
      8090,
    );
    running.push(runner.name);
    const verifier = start(
      "verifier",
      {
        QUOREM_PRIVATE_SERVICE: "verifier",
        QUOREM_VERIFIER_LISTEN: "0.0.0.0:8091",
        QUOREM_VERIFICATION_SOURCE_ORIGIN: "http://127.0.0.1:8080",
        QUOREM_VERIFICATION_SOURCE_KEY: "d".repeat(64),
        QUOREM_VERIFICATION_SERVICE_KEY: "e".repeat(64),
        QUOREM_VERIFICATION_SIGNING_KEY_PEM: verifyKey.private,
      },
      8091,
    );
    running.push(verifier.name);
    await Promise.all([waitHealth(runner.port), waitHealth(verifier.port)]);
    for (const [name, variable] of [
      [runner.name, "QUOREM_CASE_OWNER_PUBLIC_KEY_FILE"],
      [verifier.name, "QUOREM_VERIFICATION_SIGNING_KEY_FILE"],
    ]) {
      const mode = docker([
        "exec",
        name,
        "node",
        "-e",
        `const fs=require('fs');const p=fs.readdirSync('/tmp').find(x=>x.startsWith('quorem-private-'));const f='/tmp/'+p+'/key.pem';process.stdout.write((fs.statSync(f).mode&0o777).toString(8))`,
      ]);
      assert.equal(mode, "600", variable);
    }
    assert.equal(
      (await fetch(`http://127.0.0.1:${runner.port}/internal/drain`, { method: "POST" })).status,
      401,
    );
    assert.notEqual(
      (await fetch(`http://127.0.0.1:${verifier.port}/internal/results/verify`, { method: "POST" }))
        .status,
      200,
    );
  } finally {
    for (const name of running) {
      try {
        docker(["rm", "-f", name]);
      } catch {}
    }
  }
}, 30000);
