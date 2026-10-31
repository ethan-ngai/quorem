/** @file runtime.test.ts @description Spawned private service lifecycle tests. @module runner */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

async function port() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const value = address.port;
  await new Promise<void>((done) => server.close(() => done()));
  return value;
}
async function healthy(url: string, child: ChildProcess) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("service exited early");
    try {
      if ((await fetch(`${url}/health`)).status === 200) return;
    } catch {
      /* listener starting */
    }
    await sleep(50);
  }
  throw new Error("service did not start");
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return child.exitCode;
  const ended = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  try {
    const [code] = await ended;
    return code;
  } finally {
    clearTimeout(timer);
  }
}
void test("verifier process validates credentials, serves privately, and stops", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorem-verifier-process-"));
  const { privateKey } = generateKeyPairSync("ed25519"),
    file = join(dir, "key.pem");
  await writeFile(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const listen = await port(),
    base = `http://127.0.0.1:${listen}`;
  const env = {
    ...process.env,
    QUOREM_VERIFIER_LISTEN: `127.0.0.1:${listen}`,
    QUOREM_VERIFICATION_SOURCE_ORIGIN: "http://127.0.0.1:9",
    QUOREM_VERIFICATION_SOURCE_KEY: "11".repeat(32),
    QUOREM_VERIFICATION_SERVICE_KEY: "22".repeat(32),
    QUOREM_VERIFICATION_SIGNING_KEY_FILE: file,
  };
  const child = spawn(process.execPath, [resolve("src/runtime/verifier.ts")], {
    env,
    stdio: "ignore",
  });
  try {
    await healthy(base, child);
    assert.equal(
      (
        await fetch(`${base}/internal/results/verify`, {
          method: "POST",
          headers: { authorization: `Bearer ${"33".repeat(32)}` },
          body: "{}",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${base}/internal/results/verify`, {
          method: "POST",
          headers: { authorization: `Bearer ${"22".repeat(32)}` },
          body: "{}",
        })
      ).status,
      503,
    );
    assert.equal(await stop(child), 0);
    const invalid = spawn(process.execPath, [resolve("src/runtime/verifier.ts")], {
      env: { ...env, QUOREM_VERIFICATION_SOURCE_KEY: env.QUOREM_VERIFICATION_SERVICE_KEY },
      stdio: "ignore",
    });
    const [code] = await once(invalid, "exit");
    assert.equal(code, 1);
  } finally {
    if (child.exitCode === null) await stop(child);
    await rm(dir, { recursive: true, force: true });
  }
});
void test(
  "Docker runner process rejects wrong drain credential and shuts down",
  { skip: !process.env.QUOREM_TEST_DOCKER_SOCKET },
  async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "quorem-runner-process-"))),
      listen = await port(),
      base = `http://127.0.0.1:${listen}`;
    const env = {
      ...process.env,
      QUOREM_RUNNER_MODE: "http",
      QUOREM_SANDBOX_PROVIDER: "docker",
      QUOREM_RUNNER_LISTEN: `127.0.0.1:${listen}`,
      QUOREM_RUNNER_COMMAND_ORIGIN: "http://127.0.0.1:9",
      QUOREM_RUNNER_COMMAND_SECRET: "command-fixture-12345678901234567890",
      QUOREM_RUNNER_DRAIN_SECRET: "drain-fixture-1234567890123456789012",
      QUOREM_DOCKER_SOCKET: process.env.QUOREM_TEST_DOCKER_SOCKET!,
      QUOREM_DOCKER_FENCE_ROOT: dir,
      QUOREM_DOCKER_NAMESPACE: "process-test",
    };
    const child = spawn(process.execPath, [resolve("src/runtime/runner.ts")], {
      env,
      stdio: "ignore",
    });
    try {
      await healthy(base, child);
      assert.equal(
        (
          await fetch(`${base}/internal/drain`, {
            method: "POST",
            headers: { authorization: `Bearer ${"wrong".repeat(8)}` },
          })
        ).status,
        401,
      );
      assert.equal(await stop(child), 0);
    } finally {
      if (child.exitCode === null) await stop(child);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
void test(
  "continuous process polls authoritative queue and stops",
  { skip: !process.env.QUOREM_TEST_DOCKER_SOCKET },
  async () => {
    const { createServer: httpServer } = await import("node:http");
    let checks = 0;
    const api = httpServer((request, response) => {
      if (request.headers.authorization !== "Bearer command-fixture-12345678901234567890") {
        response.writeHead(401).end();
        return;
      }
      if (request.url === "/internal/runner/state") {
        checks++;
        response.end('{"queued":0,"running":0}');
      } else if (request.url === "/internal/runner/empty") response.end("true");
      else response.end("null");
    });
    api.listen(0, "127.0.0.1");
    await once(api, "listening");
    const apiAddress = api.address();
    if (!apiAddress || typeof apiAddress === "string") throw new Error("address");
    const dir = await realpath(await mkdtemp(join(tmpdir(), "quorem-runner-continuous-"))),
      listen = await port(),
      base = `http://127.0.0.1:${listen}`;
    const env = {
      ...process.env,
      QUOREM_RUNNER_MODE: "continuous",
      QUOREM_SANDBOX_PROVIDER: "docker",
      QUOREM_RUNNER_LISTEN: `127.0.0.1:${listen}`,
      QUOREM_RUNNER_COMMAND_ORIGIN: `http://127.0.0.1:${apiAddress.port}`,
      QUOREM_RUNNER_COMMAND_SECRET: "command-fixture-12345678901234567890",
      QUOREM_RUNNER_DRAIN_SECRET: "drain-fixture-1234567890123456789012",
      QUOREM_DOCKER_SOCKET: process.env.QUOREM_TEST_DOCKER_SOCKET!,
      QUOREM_DOCKER_FENCE_ROOT: dir,
      QUOREM_DOCKER_NAMESPACE: "continuous-test",
    };
    const child = spawn(process.execPath, [resolve("src/runtime/runner.ts")], {
      env,
      stdio: "ignore",
    });
    try {
      await healthy(base, child);
      for (let i = 0; i < 100 && !checks; i++) await sleep(50);
      assert.ok(checks > 0);
      assert.equal(await stop(child), 0);
    } finally {
      if (child.exitCode === null) await stop(child);
      await new Promise<void>((done) => api.close(() => done()));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
void test("configuration rejects insecure origins, duplicate secrets and malformed listeners", async () => {
  const { runnerConfig, verifierConfig } = await import("./config.ts");
  const runner = {
    QUOREM_RUNNER_MODE: "http",
    QUOREM_SANDBOX_PROVIDER: "docker",
    QUOREM_RUNNER_LISTEN: "127.0.0.1:8000",
    QUOREM_RUNNER_COMMAND_ORIGIN: "http://127.0.0.1:9000",
    QUOREM_RUNNER_COMMAND_SECRET: "command-fixture-12345678901234567890",
    QUOREM_RUNNER_DRAIN_SECRET: "drain-fixture-1234567890123456789012",
    QUOREM_DOCKER_SOCKET: "/tmp/docker.sock",
    QUOREM_DOCKER_FENCE_ROOT: "/tmp/fence",
    QUOREM_DOCKER_NAMESPACE: "fixture",
  };
  assert.equal(runnerConfig(runner).mode, "http");
  assert.throws(() => runnerConfig({ ...runner, QUOREM_SANDBOX_PROVIDER: undefined }));
  const remote = {
    ...runner,
    QUOREM_SANDBOX_PROVIDER: "remote",
    QUOREM_CASE_ORIGIN: "http://127.0.0.1:9001",
    QUOREM_CASE_SECRET: "case-fixture-secret-1234567890123456",
    QUOREM_CASE_NAMESPACE_ID: "a".repeat(64),
    QUOREM_CASE_OWNER_PUBLIC_KEY_FILE: "/tmp/owner.pem",
    QUOREM_DOCKER_SOCKET: undefined,
    QUOREM_DOCKER_FENCE_ROOT: undefined,
    QUOREM_DOCKER_NAMESPACE: undefined,
  };
  assert.equal(runnerConfig(remote).sandbox.provider, "remote");
  assert.throws(() => runnerConfig({ ...remote, QUOREM_CASE_NAMESPACE_ID: "bad" }));
  assert.throws(() => runnerConfig({ ...remote, QUOREM_CASE_ORIGIN: "http://example.test" }));
  assert.throws(() =>
    runnerConfig({ ...remote, QUOREM_CASE_SECRET: remote.QUOREM_RUNNER_COMMAND_SECRET }),
  );
  assert.throws(() => runnerConfig({ ...remote, QUOREM_CASE_ACCESS_CLIENT_ID: "case-id" }));
  assert.throws(() =>
    runnerConfig({
      ...remote,
      QUOREM_CASE_ACCESS_CLIENT_ID: "case-id",
      QUOREM_CASE_ACCESS_CLIENT_SECRET: "case-secret",
    }),
  );
  const withCaseAccess = runnerConfig({
    ...remote,
    QUOREM_CASE_ORIGIN: "https://case.example",
    QUOREM_CASE_ACCESS_CLIENT_ID: "case-id",
    QUOREM_CASE_ACCESS_CLIENT_SECRET: "case-secret",
  });
  assert.equal(withCaseAccess.sandbox.provider, "remote");
  if (withCaseAccess.sandbox.provider === "remote")
    assert.equal(withCaseAccess.sandbox.access?.id, "case-id");
  assert.throws(() =>
    runnerConfig({ ...runner, QUOREM_RUNNER_COMMAND_ORIGIN: "http://external.example" }),
  );
  assert.throws(() =>
    runnerConfig({ ...runner, QUOREM_RUNNER_COMMAND_ORIGIN: "https://user:password@example.test" }),
  );
  assert.throws(() =>
    runnerConfig({ ...runner, QUOREM_RUNNER_DRAIN_SECRET: runner.QUOREM_RUNNER_COMMAND_SECRET }),
  );
  assert.throws(() => runnerConfig({ ...runner, QUOREM_RUNNER_LISTEN: "example.test:8000" }));
  assert.throws(() => runnerConfig({ ...runner, CLOUDFLARE_ACCESS_CLIENT_ID: "fixture" }));
  assert.throws(() =>
    runnerConfig({
      ...runner,
      CLOUDFLARE_ACCESS_CLIENT_ID: "fixture",
      CLOUDFLARE_ACCESS_CLIENT_SECRET: "fixture",
    }),
  );
  assert.ok(
    runnerConfig({
      ...runner,
      QUOREM_RUNNER_COMMAND_ORIGIN: "https://private.example",
      CLOUDFLARE_ACCESS_CLIENT_ID: "fixture-id",
      CLOUDFLARE_ACCESS_CLIENT_SECRET: "fixture-secret",
    }).access,
  );

  await assert.rejects(
    verifierConfig({
      QUOREM_VERIFICATION_SOURCE_KEY: "11".repeat(32),
      QUOREM_VERIFICATION_SERVICE_KEY: "11".repeat(32),
    }),
  );
});
void test("remote runner process validates owner key before listening", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorem-remote-process-"));
  const file = join(dir, "owner.pem");
  const { publicKey } = generateKeyPairSync("ed25519");
  await writeFile(file, publicKey.export({ type: "spki", format: "pem" }));
  const listen = await port(),
    base = `http://127.0.0.1:${listen}`;
  const env = {
    ...process.env,
    QUOREM_RUNNER_MODE: "http",
    QUOREM_SANDBOX_PROVIDER: "remote",
    QUOREM_RUNNER_LISTEN: `127.0.0.1:${listen}`,
    QUOREM_RUNNER_COMMAND_ORIGIN: "http://127.0.0.1:9",
    QUOREM_RUNNER_COMMAND_SECRET: "command-fixture-12345678901234567890",
    QUOREM_RUNNER_DRAIN_SECRET: "drain-fixture-1234567890123456789012",
    QUOREM_CASE_ORIGIN: "http://127.0.0.1:10",
    QUOREM_CASE_SECRET: "case-fixture-secret-1234567890123456",
    QUOREM_CASE_NAMESPACE_ID: "a".repeat(64),
    QUOREM_CASE_OWNER_PUBLIC_KEY_FILE: file,
  };
  const child = spawn(process.execPath, [resolve("src/runtime/runner.ts")], {
    env,
    stdio: "ignore",
  });
  try {
    await healthy(base, child);
    assert.equal(
      (
        await fetch(`${base}/internal/drain`, {
          method: "POST",
          headers: { authorization: `Bearer ${"wrong".repeat(8)}` },
        })
      ).status,
      401,
    );
    assert.equal(await stop(child), 0);
    await writeFile(file, "invalid");
    const invalid = spawn(process.execPath, [resolve("src/runtime/runner.ts")], {
      env,
      stdio: "ignore",
    });
    assert.equal((await once(invalid, "exit"))[0], 1);
  } finally {
    if (child.exitCode === null) await stop(child);
    await rm(dir, { recursive: true, force: true });
  }
});
void test("optional private ingress credentials stay on the pinned HTTPS origin", async () => {
  const { accessFetch } = await import("@quorem/execution/transport/access");
  let calls = 0;
  const send: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(
      input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      "https://private.example/internal/runner/state",
    );
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer fixture");
    assert.equal(headers.get("CF-Access-Client-Id"), "fixture-id");
    assert.equal(headers.get("CF-Access-Client-Secret"), "fixture-secret");
    return new Response(null, { status: 204 });
  };
  const wrapped = accessFetch(
    "https://private.example",
    { id: "fixture-id", secret: "fixture-secret" },
    send,
  )!;
  await wrapped("https://private.example/internal/runner/state", {
    method: "POST",
    headers: { authorization: "Bearer fixture" },
  });
  await assert.rejects(wrapped("https://other.example/internal/runner/state"));
  await assert.rejects(wrapped("http://private.example/internal/runner/state"));
  assert.equal(calls, 1);
});
