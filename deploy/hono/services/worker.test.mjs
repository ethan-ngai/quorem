import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { RunnerService, VerifierService } from "./worker.js";
const secret = (value) => value.repeat(64);
const base = () => ({
  DRAIN_ORIGIN: "https://runner-stage.example.test",
  VERIFIER_ORIGIN: "https://verify-stage.example.test",
  CASE_ORIGIN: "https://case-stage.example.test",
  QUOREM_CASE_ORIGIN: "https://case-stage.example.test",
  QUOREM_RUNNER_COMMAND_SECRET: secret("a"),
  QUOREM_RUNNER_DRAIN_SECRET: secret("b"),
  QUOREM_CASE_SECRET: secret("c"),
  QUOREM_VERIFICATION_SOURCE_KEY: secret("d"),
  QUOREM_VERIFICATION_SERVICE_KEY: secret("e"),
  RUNNER_API_ACCESS_CLIENT_ID: "runner-id",
  RUNNER_API_ACCESS_CLIENT_SECRET: secret("f"),
  VERIFIER_API_ACCESS_CLIENT_ID: "verifier-id",
  VERIFIER_API_ACCESS_CLIENT_SECRET: secret("g"),
  QUOREM_CASE_ACCESS_CLIENT_ID: "case-id",
  QUOREM_CASE_ACCESS_CLIENT_SECRET: secret("h"),
  QUOREM_CASE_OWNER_PUBLIC_KEY_PEM: "public key",
  QUOREM_VERIFICATION_SIGNING_KEY_PEM: "private key",
  CASE_OWNER_PRIVATE_KEY: "case private key",
});
function target(name, seen) {
  return {
    getByName(value) {
      assert.equal(value, name);
      return {
        async fetch(request) {
          seen.push(request);
          return new Response(null, { status: 204 });
        },
      };
    },
  };
}
test("private ingress pins capability host, method, bearer and strips Access secrets", async () => {
  const env = base(),
    seen = [];
  env.QUOREM_CASE_NAMESPACE_ID = secret("1");
  env.CASES = { idFromName: () => secret("1") };
  env.RUNNERS = target("runner", seen);
  env.VERIFIERS = target("verifier", seen);
  const call = (origin, path, token, method = "POST") =>
    worker.fetch(
      new Request(`${origin}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "CF-Access-Client-Id": "id",
          "CF-Access-Client-Secret": "secret",
        },
      }),
      env,
    );
  assert.equal(
    (await call(env.DRAIN_ORIGIN, "/internal/drain", env.QUOREM_RUNNER_DRAIN_SECRET)).status,
    204,
  );
  assert.equal(
    (
      await call(
        env.VERIFIER_ORIGIN,
        "/internal/results/verify",
        env.QUOREM_VERIFICATION_SERVICE_KEY,
      )
    ).status,
    204,
  );
  const namespace = await worker.fetch(
    new Request(`${env.CASE_ORIGIN}/internal/case/namespace`, {
      headers: { authorization: `Bearer ${env.QUOREM_CASE_SECRET}` },
    }),
    env,
  );
  assert.deepEqual(await namespace.json(), { namespace: secret("1") });
  env.QUOREM_CASE_NAMESPACE_ID = secret("2");
  assert.equal(
    (await call(env.DRAIN_ORIGIN, "/internal/drain", env.QUOREM_RUNNER_DRAIN_SECRET)).status,
    503,
  );
  env.QUOREM_CASE_NAMESPACE_ID = secret("1");
  assert.equal(seen.length, 2);
  for (const request of seen) {
    assert.equal(request.headers.get("cf-access-client-secret"), null);
    assert.equal(request.headers.get("cf-access-client-id"), null);
  }
  for (const result of [
    await call(env.VERIFIER_ORIGIN, "/internal/drain", env.QUOREM_RUNNER_DRAIN_SECRET),
    await call(env.DRAIN_ORIGIN, "/internal/drain", env.QUOREM_CASE_SECRET),
    await call("https://alternate.example.test", "/internal/drain", env.QUOREM_RUNNER_DRAIN_SECRET),
    await call(env.DRAIN_ORIGIN, "/internal/drain", env.QUOREM_RUNNER_DRAIN_SECRET, "GET"),
  ])
    assert.equal(result.status, 404);
  assert.equal(
    (
      await worker.fetch(
        new Request(`${env.CASE_ORIGIN}/internal/case/one`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${env.QUOREM_CASE_SECRET}` },
        }),
        env,
      )
    ).status,
    404,
  );
  assert.equal(
    (await call(env.DRAIN_ORIGIN, "/internal/drain", env.QUOREM_RUNNER_DRAIN_SECRET, "POST"))
      .status,
    204,
  );
  env.QUOREM_CASE_SECRET = env.QUOREM_RUNNER_DRAIN_SECRET;
  assert.equal(
    (await call(env.DRAIN_ORIGIN, "/internal/drain", env.QUOREM_RUNNER_DRAIN_SECRET)).status,
    503,
  );
});
test("trusted container environment is purpose-scoped", () => {
  const env = base(),
    ctx = { container: {}, waitUntil() {} };
  const runner = new RunnerService(ctx, env).lifecycle.runtime,
    verifier = new VerifierService(ctx, env).lifecycle.runtime;
  assert.equal(runner.QUOREM_CASE_SECRET, env.QUOREM_CASE_SECRET);
  assert.equal(runner.QUOREM_VERIFICATION_SIGNING_KEY_PEM, undefined);
  assert.equal(
    verifier.QUOREM_VERIFICATION_SIGNING_KEY_PEM,
    env.QUOREM_VERIFICATION_SIGNING_KEY_PEM,
  );
  assert.equal(verifier.QUOREM_CASE_SECRET, undefined);
  assert.equal(verifier.QUOREM_RUNNER_COMMAND_SECRET, undefined);
  assert.notEqual(runner.CLOUDFLARE_ACCESS_CLIENT_SECRET, verifier.CLOUDFLARE_ACCESS_CLIENT_SECRET);
});
test("service lifecycle starts once and forwards only the intended request", async () => {
  const env = base(),
    calls = [],
    running = { value: false };
  const container = {
    get running() {
      return running.value;
    },
    start(options) {
      calls.push(options);
      running.value = true;
    },
    async setInactivityTimeout() {},
    monitor() {
      return new Promise(() => {});
    },
    getTcpPort(port) {
      return {
        async fetch(request) {
          if (typeof request === "string") return new Response(null, { status: 200 });
          assert.equal(port, 8090);
          assert.equal(request.headers.get("cf-access-client-secret"), null);
          return new Response("drained");
        },
      };
    },
  };
  const service = new RunnerService({ container, waitUntil() {} }, env);
  const request = () =>
    new Request(`${env.DRAIN_ORIGIN}/internal/drain`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.QUOREM_RUNNER_DRAIN_SECRET}`,
        "cf-access-client-secret": "strip",
      },
    });
  assert.equal(await (await service.fetch(request())).text(), "drained");
  assert.equal(await (await service.fetch(request())).text(), "drained");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].env.QUOREM_SANDBOX_PROVIDER, "remote");
  assert.equal(calls[0].env.QUOREM_VERIFICATION_SIGNING_KEY_PEM, undefined);
  assert.equal(calls[0].env.QUOREM_CASE_SECRET, env.QUOREM_CASE_SECRET);
});
