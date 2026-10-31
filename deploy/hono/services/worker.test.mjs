import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync, randomUUID, createHash } from "node:crypto";
import { verifyCaseProbe } from "../../case-proof.js";
import { CaseSandbox } from "../../case-sandbox.js";
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
  const keys = generateKeyPairSync("ed25519");
  env.CASE_DIAGNOSTICS = "true";
  env.CASE_OWNER_PRIVATE_KEY = keys.privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("base64");
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
  const nonce = randomUUID();
  const namespace = await worker.fetch(
    new Request(`${env.CASE_ORIGIN}/internal/case/namespace`, {
      headers: { authorization: `Bearer ${env.QUOREM_CASE_SECRET}`, "x-quorem-owner-nonce": nonce },
    }),
    env,
  );
  const publicKey = await crypto.subtle.importKey(
    "spki",
    keys.publicKey.export({ type: "spki", format: "der" }),
    "Ed25519",
    false,
    ["verify"],
  );
  assert.deepEqual(
    await verifyCaseProbe(namespace, {
      publicKey,
      kind: "namespace",
      scope: "",
      attempt: "namespace",
      nonce,
    }),
    { namespace: secret("1") },
  );
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
test("signed live case observation follows execution and confirmed attempt teardown", async () => {
  const env = base(),
    keys = generateKeyPairSync("ed25519"),
    namespace = secret("1"),
    attempt = randomUUID(),
    token = randomUUID();
  env.CASE_DIAGNOSTICS = "true";
  env.QUOREM_CASE_NAMESPACE_ID = namespace;
  env.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM = keys.publicKey.export({ type: "spki", format: "pem" });
  env.CASE_OWNER_PRIVATE_KEY = keys.privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("base64");
  const publicKey = await crypto.subtle.importKey(
    "spki",
    keys.publicKey.export({ type: "spki", format: "der" }),
    "Ed25519",
    false,
    ["verify"],
  );
  const fingerprint = createHash("sha256")
    .update(keys.publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const scope = `remote:${createHash("sha256")
    .update(JSON.stringify([env.CASE_ORIGIN, namespace, fingerprint]))
    .digest("hex")}`;
  const values = new Map();
  const context = {
    storage: {
      async get(key) {
        return values.get(key);
      },
      async put(key, value) {
        values.set(key, value);
      },
      async delete(key) {
        values.delete(key);
      },
      async setAlarm() {},
      async deleteAlarm() {},
    },
    waitUntil() {},
    container: {
      images: { python: "fixture" },
      running: false,
      start() {
        this.running = true;
      },
      async setInactivityTimeout() {},
      async destroy() {
        this.running = false;
      },
      async exec() {
        return {
          stdin: new WritableStream(),
          stdout: new ReadableStream(),
          stderr: new ReadableStream(),
          exitCode: new Promise(() => {}),
        };
      },
    },
  };
  const sandbox = new CaseSandbox(context, env);
  env.CASES = {
    idFromName: () => namespace,
    getByName: (id) => {
      assert.equal(id, attempt);
      return sandbox;
    },
  };
  const body = "fixture",
    digest = createHash("sha256").update(body).digest("hex");
  const startNonce = randomUUID();
  const started = await worker.fetch(
    new Request(`${env.CASE_ORIGIN}/internal/case/${attempt}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
        "x-quorem-owner-nonce": startNonce,
        "x-quorem-owner-scope": scope,
        "x-quorem-case-binding": secret("2"),
        "x-quorem-body-sha256": digest,
        "x-quorem-case-ordinal": "400",
        "x-case-token": token,
        "x-case-language": "python",
        "x-case-memory": "1024",
        "x-case-processes": "1",
      },
      body,
    }),
    env,
  );
  assert.equal(started.status, 200);
  const probe = async (nonce, override = scope) =>
    worker.fetch(
      new Request(`${env.CASE_ORIGIN}/internal/case/${attempt}`, {
        headers: {
          authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
          "x-quorem-owner-nonce": nonce,
          "x-quorem-owner-scope": override,
          "x-quorem-case-probe": "lifecycle",
        },
      }),
      env,
    );
  const nonce = randomUUID(),
    response = await probe(nonce);
  const proof = await verifyCaseProbe(response.clone(), {
    publicKey,
    kind: "lifecycle",
    scope,
    attempt,
    nonce,
    expectedNamespace: namespace,
  });
  assert.deepEqual(proof, {
    active: true,
    running: true,
    ordinal: 400,
    tokenHash: createHash("sha256").update(token).digest("hex"),
  });
  assert.ok(!JSON.stringify(proof).includes(token));
  await assert.rejects(
    verifyCaseProbe(response.clone(), {
      publicKey,
      kind: "lifecycle",
      scope,
      attempt,
      nonce,
      expectedNamespace: secret("2"),
    }),
  );
  const forged = new Response(
    JSON.stringify({ active: false, running: false, ordinal: null, tokenHash: null }),
    { status: 200, headers: response.headers },
  );
  await assert.rejects(
    verifyCaseProbe(forged, {
      publicKey,
      kind: "lifecycle",
      scope,
      attempt,
      nonce,
      expectedNamespace: namespace,
    }),
  );
  assert.equal(
    (
      await worker.fetch(
        new Request(`${env.CASE_ORIGIN}/internal/case/${attempt}`, {
          headers: {
            authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
            "x-quorem-owner-nonce": randomUUID(),
            "x-quorem-owner-scope": scope,
            "x-quorem-case-probe": "lifecycle",
            "x-case-token": randomUUID(),
          },
        }),
        env,
      )
    ).status,
    404,
  );
  await assert.rejects(
    verifyCaseProbe(response, {
      publicKey,
      kind: "lifecycle",
      scope,
      attempt,
      nonce: randomUUID(),
      expectedNamespace: namespace,
    }),
  );
  assert.equal((await probe(randomUUID(), `remote:${secret("0")}`)).status, 404);
  const stopNonce = randomUUID();
  const stopped = await worker.fetch(
    new Request(`${env.CASE_ORIGIN}/internal/case/${attempt}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
        "x-quorem-owner-nonce": stopNonce,
        "x-quorem-owner-scope": scope,
      },
    }),
    env,
  );
  assert.equal(stopped.status, 204);
  const signature = Uint8Array.from(atob(stopped.headers.get("x-quorem-owner-signature")), (c) =>
    c.charCodeAt(0),
  );
  const message = new TextEncoder().encode(
    JSON.stringify([
      scope,
      namespace,
      "DELETE",
      attempt,
      "",
      204,
      stopNonce,
      "",
      "",
      "",
      "",
      "",
      "",
    ]),
  );
  assert.equal(await crypto.subtle.verify("Ed25519", publicKey, signature, message), true);
  const afterNonce = randomUUID();
  assert.deepEqual(
    await verifyCaseProbe(await probe(afterNonce), {
      publicKey,
      kind: "lifecycle",
      scope,
      attempt,
      nonce: afterNonce,
      expectedNamespace: namespace,
    }),
    { active: false, running: false, ordinal: null, tokenHash: null },
  );
  env.CASE_DIAGNOSTICS = "false";
  assert.equal((await probe(randomUUID())).status, 404);
});
