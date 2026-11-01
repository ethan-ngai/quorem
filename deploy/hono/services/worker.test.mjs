import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync, randomUUID, createHash } from "node:crypto";
import { signedCaseProbe, verifyCaseProbe } from "../../case-proof.js";
import { CaseSandbox } from "../../case-sandbox.js";
import worker, { ImageService, RunnerService, VerifierService } from "./worker.js";
const secret = (value) => value.repeat(64);
const base = () => {
  const env = {
    DRAIN_ORIGIN: "https://runner-stage.example.test",
    VERIFIER_ORIGIN: "https://verify-stage.example.test",
    CASE_ORIGIN: "https://case-stage.example.test",
    QUOREM_CASE_ORIGIN: "https://case-stage.example.test",
    QUOREM_RUNNER_COMMAND_SECRET: secret("a"),
    QUOREM_RUNNER_DRAIN_SECRET: secret("b"),
    QUOREM_CASE_SECRET: secret("c"),
    QUOREM_VERIFICATION_SOURCE_KEY: secret("d"),
    QUOREM_VERIFICATION_SERVICE_KEY: secret("e"),
    QUOREM_CASE_OWNER_PUBLIC_KEY_PEM: "public key",
    QUOREM_VERIFICATION_SIGNING_KEY_PEM: "private key",
    CASE_OWNER_PRIVATE_KEY: "case private key",
    RECOVERY_CONTROL_SECRET: secret("r"),
    SERVICES_RELEASE: "a".repeat(40),
    SERVICES_GENERATION: "1",
    SERVICES_BINDINGS: secret("9"),
  };
  env.RUNNER_CONTROL = {
    getByName: () => ({
      fetch: async () =>
        Response.json({
          generation: 1,
          release: env.SERVICES_RELEASE,
          bindings: env.SERVICES_BINDINGS,
          runner: `runner:${env.SERVICES_RELEASE}:1`,
        }),
    }),
  };
  env.CASE_CONTROL = {
    getByName: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
  };
  return env;
};
void test("control authority gates drains and registers authorized case attempts first", async () => {
  const env = base(),
    keys = generateKeyPairSync("ed25519"),
    namespace = secret("1"),
    events = [];
  env.QUOREM_CASE_NAMESPACE_ID = namespace;
  env.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM = keys.publicKey.export({ type: "spki", format: "pem" });
  env.CASE_OWNER_PRIVATE_KEY = keys.privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("base64");
  const fingerprint = createHash("sha256")
    .update(keys.publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const scope = `remote:${createHash("sha256")
    .update(JSON.stringify([env.CASE_ORIGIN, namespace, fingerprint]))
    .digest("hex")}`;
  let gate = true,
    registered = true,
    gateBindings = env.SERVICES_BINDINGS,
    gateGeneration = 1,
    gateRelease = env.SERVICES_RELEASE,
    gateRunner = `runner:${env.SERVICES_RELEASE}:1`;
  env.RUNNER_CONTROL = {
    getByName: (name) => {
      assert.equal(name, "runner-control");
      return {
        fetch: async (request) => {
          assert.equal(request.headers.get("authorization"), null);
          assert.equal(request.headers.get("cf-access-client-secret"), null);
          events.push(`gate:${new URL(request.url).pathname}`);
          if (new URL(request.url).pathname === "/state")
            return Response.json({
              generation: 1,
              status: "active",
              release: env.SERVICES_RELEASE,
              bindings: env.SERVICES_BINDINGS,
            });
          return gate
            ? Response.json({
                generation: gateGeneration,
                release: gateRelease,
                bindings: gateBindings,
                runner: gateRunner,
              })
            : new Response(null, { status: 503 });
        },
      };
    },
  };
  env.RUNNERS = {
    getByName: (name) => {
      assert.equal(name, `runner:${env.SERVICES_RELEASE}:1`);
      return {
        fetch: async () => {
          events.push("drain");
          return new Response(null, { status: 204 });
        },
      };
    },
  };
  env.CASE_CONTROL = {
    getByName: (name) => {
      assert.equal(name, "case-control");
      return {
        fetch: async (request) => {
          assert.equal(request.headers.get("authorization"), null);
          assert.equal(request.headers.get("cf-access-client-secret"), null);
          events.push(`control:${new URL(request.url).pathname}`);
          if (new URL(request.url).pathname === "/register")
            assert.deepEqual(await request.json(), {
              attempt: "one",
              generation: 1,
              release: env.SERVICES_RELEASE,
            });
          return new Response(null, { status: registered ? 204 : 503 });
        },
      };
    },
  };
  env.CASES = {
    idFromName: () => namespace,
    getByName: () => ({
      fetch: async () => {
        events.push("case");
        return new Response("ok");
      },
    }),
  };
  const drain = () =>
    worker.fetch(
      new Request(`${env.DRAIN_ORIGIN}/internal/drain`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.QUOREM_RUNNER_DRAIN_SECRET}` },
      }),
      env,
    );
  assert.equal((await drain()).status, 204);
  assert.deepEqual(events.splice(0), ["gate:/gate", "drain"]);
  gate = false;
  assert.equal((await drain()).status, 503);
  assert.deepEqual(events.splice(0), ["gate:/gate"]);
  gate = true;
  gateBindings = secret("8");
  assert.equal((await drain()).status, 503);
  assert.deepEqual(events.splice(0), ["gate:/gate"]);
  gateBindings = env.SERVICES_BINDINGS;
  for (const field of ["generation", "release", "runner"]) {
    if (field === "generation") gateGeneration = 2;
    if (field === "release") gateRelease = "b".repeat(40);
    if (field === "runner") gateRunner = "runner:wrong:1";
    assert.equal((await drain()).status, 503);
    assert.deepEqual(events.splice(0), ["gate:/gate"]);
    gateGeneration = 1;
    gateRelease = env.SERVICES_RELEASE;
    gateRunner = `runner:${env.SERVICES_RELEASE}:1`;
  }
  gate = false;
  assert.equal(
    (
      await worker.fetch(
        new Request(`${env.DRAIN_ORIGIN}/internal/pause`, {
          method: "POST",
          headers: { authorization: `Bearer ${env.QUOREM_RUNNER_DRAIN_SECRET}` },
        }),
        env,
      )
    ).status,
    204,
  );
  assert.deepEqual(events.splice(0), ["drain"]);
  const body = "fixture",
    digest = createHash("sha256").update(body).digest("hex");
  const post = (token = env.QUOREM_CASE_SECRET) =>
    worker.fetch(
      new Request(`${env.CASE_ORIGIN}/internal/case/one`, {
        method: "POST",
        headers: {
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
          "x-quorem-owner-scope": scope,
          "x-quorem-owner-nonce": randomUUID(),
          "x-quorem-case-binding": secret("2"),
          "x-quorem-body-sha256": digest,
          "x-quorem-case-ordinal": "0",
        },
        body,
      }),
      env,
    );
  assert.equal((await post(secret("z"))).status, 404);
  assert.equal((await post(null)).status, 404);
  assert.deepEqual(events, []);
  registered = false;
  assert.equal((await post()).status, 503);
  assert.deepEqual(events.splice(0), ["control:/register"]);
  registered = true;
  assert.equal((await post()).status, 200);
  assert.deepEqual(events.splice(0), ["control:/register", "case"]);
  const adminCase = (token, ownerScope = scope) =>
    worker.fetch(
      new Request(`${env.CASE_ORIGIN}/internal/control/case/state`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-quorem-owner-scope": ownerScope,
          "x-quorem-owner-nonce": randomUUID(),
        },
      }),
      env,
    );
  assert.equal((await adminCase(env.QUOREM_CASE_SECRET)).status, 404);
  assert.deepEqual(events, []);
  assert.equal((await adminCase(env.RECOVERY_CONTROL_SECRET, `remote:${secret("8")}`)).status, 404);
  assert.deepEqual(events, []);
  assert.equal((await adminCase(env.RECOVERY_CONTROL_SECRET)).status, 204);
  assert.deepEqual(events.splice(0), ["control:/state"]);
  gate = true;
  const runnerNonce = randomUUID();
  const adminRunner = (token) =>
    worker.fetch(
      new Request(`${env.DRAIN_ORIGIN}/internal/control/runner/state`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-quorem-owner-scope": scope,
          "x-quorem-owner-nonce": runnerNonce,
        },
      }),
      env,
    );
  assert.equal((await adminRunner(env.QUOREM_RUNNER_DRAIN_SECRET)).status, 404);
  assert.deepEqual(events, []);
  const runnerState = await adminRunner(env.RECOVERY_CONTROL_SECRET);
  assert.equal(runnerState.status, 200);
  const publicKey = await crypto.subtle.importKey(
    "spki",
    keys.publicKey.export({ type: "spki", format: "der" }),
    "Ed25519",
    false,
    ["verify"],
  );
  assert.deepEqual(
    await verifyCaseProbe(runnerState, {
      publicKey,
      kind: "runner-control-state",
      scope,
      attempt: "runner-control",
      nonce: runnerNonce,
      expectedNamespace: namespace,
    }),
    {
      generation: 1,
      status: "active",
      release: env.SERVICES_RELEASE,
      bindings: env.SERVICES_BINDINGS,
    },
  );
  const invalidSigned = await signedCaseProbe(env, {
    kind: "runner-control-state",
    scope,
    attempt: "runner-control",
    nonce: runnerNonce,
    value: { generation: 1, status: "active", release: null, bindings: null },
  });
  await assert.rejects(
    verifyCaseProbe(invalidSigned, {
      publicKey,
      kind: "runner-control-state",
      scope,
      attempt: "runner-control",
      nonce: runnerNonce,
      expectedNamespace: namespace,
    }),
  );
  assert.deepEqual(events.splice(0), ["gate:/state"]);
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
void test("private ingress pins capability host, method, bearer and strips Access secrets", async () => {
  const env = base(),
    seen = [];
  const keys = generateKeyPairSync("ed25519");
  env.CASE_DIAGNOSTICS = "true";
  env.CASE_OWNER_PRIVATE_KEY = keys.privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("base64");
  env.QUOREM_CASE_NAMESPACE_ID = secret("1");
  env.CASES = { idFromName: () => secret("1") };
  env.RUNNERS = target(`runner:${env.SERVICES_RELEASE}:1`, seen);
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
  assert.equal(
    (await call(env.DRAIN_ORIGIN, "/internal/pause", env.QUOREM_RUNNER_DRAIN_SECRET)).status,
    204,
  );
  assert.equal(
    (await call(env.DRAIN_ORIGIN, "/internal/pause", env.QUOREM_CASE_SECRET)).status,
    404,
  );
  env.QUOREM_CASE_NAMESPACE_ID = secret("2");
  assert.equal(
    (await call(env.DRAIN_ORIGIN, "/internal/drain", env.QUOREM_RUNNER_DRAIN_SECRET)).status,
    503,
  );
  env.QUOREM_CASE_NAMESPACE_ID = secret("1");
  assert.equal(seen.length, 3);
  for (const request of seen) {
    assert.equal(request.headers.get("cf-access-client-secret"), null);
    assert.equal(request.headers.get("cf-access-client-id"), null);
  }
  for (const result of [
    await call(env.VERIFIER_ORIGIN, "/internal/drain", env.QUOREM_RUNNER_DRAIN_SECRET),
    await call(env.DRAIN_ORIGIN, "/internal/drain", env.QUOREM_CASE_SECRET),
    await call("https://alternate.example.test", "/internal/drain", env.QUOREM_RUNNER_DRAIN_SECRET),
    await call(env.DRAIN_ORIGIN, "/internal/drain", env.QUOREM_RUNNER_DRAIN_SECRET, "GET"),
    await worker.fetch(new Request(`${env.DRAIN_ORIGIN}/internal/drain`, { method: "POST" }), env),
    await worker.fetch(
      new Request(`${env.VERIFIER_ORIGIN}/internal/results/verify`, { method: "POST" }),
      env,
    ),
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
void test("trusted container environment is purpose-scoped", () => {
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
  assert.equal(
    Object.keys(runner).some((name) => name.includes("ACCESS_CLIENT")),
    false,
  );
  assert.equal(
    Object.keys(verifier).some((name) => name.includes("ACCESS_CLIENT")),
    false,
  );
});
void test("service lifecycle starts once and forwards only the intended request", async () => {
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
  const service = new RunnerService(
    { container, storage: { async get() {} }, waitUntil() {} },
    env,
  );
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
void test("signed live case observation follows execution and confirmed attempt teardown", async () => {
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
  const diagnostic = async (overrides = {}) =>
    worker.fetch(
      new Request(`${env.CASE_ORIGIN}/internal/case/${attempt}`, {
        headers: {
          authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
          "x-quorem-owner-nonce": randomUUID(),
          "x-quorem-owner-scope": scope,
          "x-quorem-case-probe": "diagnostics",
          ...overrides,
        },
      }),
      env,
    );
  const diagnosticResponse = await diagnostic();
  assert.equal(diagnosticResponse.status, 200);
  assert.deepEqual(await diagnosticResponse.json(), {
    phase: "exec-ready",
    failure: "none",
    source: "none",
  });
  assert.equal((await diagnostic({ authorization: "Bearer wrong" })).status, 404);
  assert.equal((await diagnostic({ "x-quorem-owner-scope": `remote:${secret("0")}` })).status, 404);
  assert.equal((await diagnostic({ "x-case-token": randomUUID() })).status, 404);
  env.CASE_DIAGNOSTICS = "false";
  assert.equal((await diagnostic()).status, 404);
  env.CASE_DIAGNOSTICS = "true";
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
  assert.equal(values.get("cancelled"), true);
  const restarted = new CaseSandbox(context, env);
  const late = await restarted.fetch(
    new Request(`${env.CASE_ORIGIN}/internal/case/${attempt}`, {
      method: "POST",
      headers: {
        "x-case-token": randomUUID(),
        "x-case-language": "python",
        "x-case-memory": "1024",
        "x-case-processes": "1",
      },
      body: "late",
    }),
  );
  assert.equal(late.status, 503);
  assert.equal(context.container.running, false);
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

void test("execution and cleanup require the actual pinned namespace and scope", async () => {
  const env = base(),
    keys = generateKeyPairSync("ed25519"),
    namespace = secret("1");
  env.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM = keys.publicKey.export({ type: "spki", format: "pem" });
  env.CASE_OWNER_PRIVATE_KEY = keys.privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("base64");
  const fingerprint = createHash("sha256")
    .update(keys.publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const scope = `remote:${createHash("sha256")
    .update(JSON.stringify([env.CASE_ORIGIN, namespace, fingerprint]))
    .digest("hex")}`;
  let forwarded = 0;
  env.CASES = {
    idFromName: () => namespace,
    getByName: () => ({
      fetch: async (request) => {
        forwarded++;
        return new Response(null, { status: request.method === "DELETE" ? 204 : 200 });
      },
    }),
  };
  const request = (method, ownerScope = scope) =>
    worker.fetch(
      new Request(`${env.CASE_ORIGIN}/internal/case/pin-test`, {
        method,
        headers: {
          authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
          "x-quorem-owner-scope": ownerScope,
          "x-quorem-owner-nonce": randomUUID(),
          "x-quorem-case-binding": secret("2"),
          "x-quorem-body-sha256": createHash("sha256").update("fixture").digest("hex"),
          "x-quorem-case-ordinal": "400",
          "x-case-token": randomUUID(),
          "x-case-language": "python",
          "x-case-memory": "1024",
          "x-case-processes": "1",
        },
        ...(method === "POST" ? { body: "fixture" } : {}),
      }),
      env,
    );
  env.QUOREM_CASE_NAMESPACE_ID = secret("0");
  assert.equal((await request("POST")).status, 503);
  assert.equal((await request("DELETE")).status, 503);
  assert.equal(forwarded, 0);
  env.QUOREM_CASE_NAMESPACE_ID = namespace;
  assert.equal((await request("POST", `remote:${secret("3")}`)).status, 503);
  assert.equal((await request("DELETE", `remote:${secret("3")}`)).status, 503);
  assert.equal(forwarded, 0);
  assert.equal((await request("POST")).status, 200);
  assert.equal(forwarded, 1);
  env.QUOREM_CASE_NAMESPACE_ID = secret("0");
  assert.equal((await request("DELETE")).status, 503);
  assert.equal(forwarded, 1);
  env.QUOREM_CASE_NAMESPACE_ID = namespace;
  assert.equal((await request("DELETE")).status, 204);
  assert.equal(forwarded, 2);
  env.QUOREM_CASE_NAMESPACE_ID = secret("0");
  env.CASES.idFromName = () => secret("0");
  const zeroScope = `remote:${createHash("sha256")
    .update(JSON.stringify([env.CASE_ORIGIN, secret("0"), fingerprint]))
    .digest("hex")}`;
  assert.equal((await request("DELETE", zeroScope)).status, 503);
  assert.equal((await request("POST", zeroScope)).status, 503);
  assert.equal(forwarded, 2);
});

void test("image ingress and authenticated local readiness are isolated", async () => {
  const env = {
    ...base(),
    IMAGE_SERVICE_ENABLED: "true",
    IMAGE_ORIGIN: "https://image-stage.example.test",
    IMAGE_SERVICE_TOKEN: secret("i"),
  };
  const seen = [];
  env.IMAGES = target("image", seen);
  const call = (token, path = "/", method = "POST") =>
    worker.fetch(
      new Request(env.IMAGE_ORIGIN + path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "CF-Access-Client-Secret": "discard",
          cookie: "discard",
          "CF-Access-Jwt-Assertion": "discard",
        },
      }),
      env,
    );
  assert.equal((await call(env.IMAGE_SERVICE_TOKEN)).status, 204);
  assert.equal(seen[0].headers.get("CF-Access-Client-Secret"), null);
  assert.equal(seen[0].headers.get("cookie"), null);
  assert.equal(seen[0].headers.get("CF-Access-Jwt-Assertion"), null);
  assert.equal((await call(secret("z"))).status, 404);
  assert.equal((await call(env.IMAGE_SERVICE_TOKEN, "/health", "GET")).status, 404);
  env.IMAGE_SERVICE_ENABLED = "false";
  assert.equal((await call(env.IMAGE_SERVICE_TOKEN)).status, 404);
  const calls = [];
  let running = false;
  const container = {
    get running() {
      return running;
    },
    start(options) {
      calls.push(options);
      running = true;
    },
    async setInactivityTimeout() {},
    monitor() {
      return new Promise(() => {});
    },
    getTcpPort(port) {
      return {
        async fetch(request, options) {
          assert.equal(port, 8083);
          if (typeof request === "string") {
            assert.equal(options.headers.authorization, `Bearer ${env.IMAGE_SERVICE_TOKEN}`);
            assert.equal(options.redirect, "manual");
            return new Response(null, { status: 200 });
          }
          return new Response("image", { headers: { "x-image-execution": "terminated" } });
        },
      };
    },
  };
  const service = new ImageService({ container, waitUntil() {} }, env);
  const response = await service.fetch(new Request(env.IMAGE_ORIGIN, { method: "POST" }));
  assert.equal(response.headers.get("x-image-execution"), "terminated");
  assert.deepEqual(Object.keys(calls[0].env).sort(), [
    "IMAGE_SERVICE_HOST",
    "IMAGE_SERVICE_PORT",
    "IMAGE_SERVICE_TOKEN",
    "IMAGE_SERVICE_TRANSPORT",
  ]);
});

void test("runner pause persists across instances and rejects subsequent drains", async () => {
  const env = base(),
    state = new Map();
  const storage = {
    async get(key) {
      return state.get(key);
    },
    async put(key, value) {
      state.set(key, value);
    },
  };
  const context = { storage, container: {}, waitUntil() {} };
  const pause = () => new Request(`${env.DRAIN_ORIGIN}/internal/pause`, { method: "POST" });
  const drain = () => new Request(`${env.DRAIN_ORIGIN}/internal/drain`, { method: "POST" });
  assert.equal((await new RunnerService(context, env).fetch(pause())).status, 204);
  assert.equal((await new RunnerService(context, env).fetch(drain())).status, 503);
  assert.equal((await new RunnerService(context, env).fetch(pause())).status, 204);
});

void test("case diagnostic inventory is bounded and emits only safe metadata", async () => {
  const { caseDiagnostics } = await import("../../../scripts/hono-stage-role-diagnostics.mjs");
  let pages = 0;
  const controls = {
    inventoryPage: async (after) => {
      pages++;
      return {
        after,
        attempts: [`attempt-${String(pages).padStart(3, "0")}`],
        next: `attempt-${String(pages).padStart(3, "0")}`,
      };
    },
  };
  const out = await caseDiagnostics(
    controls,
    "https://case-stage.example.test",
    secret("c"),
    `remote:${secret("1")}`,
    async (_url, request) => {
      assert.equal(request.headers["x-quorem-case-probe"], "diagnostics");
      return Response.json({
        phase: "exec-ready",
        failure: "secret-token-value-123",
        source: "setup",
      });
    },
  );
  assert.equal(pages, 16);
  assert.equal(out.complete, false);
  assert.equal(out.attempts.length, 16);
  assert.deepEqual(out.attempts[0], {
    index: 0,
    status: 200,
    phase: "exec-ready",
    failure: "unknown",
    source: "setup",
  });
  assert.ok(!JSON.stringify(out).includes("attempt-"));
});
