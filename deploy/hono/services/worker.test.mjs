import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync, randomUUID, createHash } from "node:crypto";
import { signedCaseProbe, verifyCaseProbe } from "../../case-proof.js";
import { CaseSandbox } from "../../case-sandbox.js";
import worker, { ImageService, MailRelayService, RunnerService } from "./worker.js";
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
function runnerNamespace() {
  const env = base(),
    contexts = new Map(),
    objects = new Map();
  env.QUOREM_CASE_NAMESPACE_ID = "namespace";
  env.CASES = { idFromName: () => env.QUOREM_CASE_NAMESPACE_ID };
  env.QUOREM_RUNNER_COMMAND_ORIGIN = "https://api.example.test";
  const name = `runner:${env.SERVICES_RELEASE}:1`;
  const get = (name) => {
    if (!contexts.has(name)) {
      const values = new Map();
      const context = {
        id: name,
        alarm: null,
        arms: 0,
        values,
        storage: {
          get: async (key) => values.get(key),
          put: async (key, value) => {
            values.set(key, value);
          },
          getAlarm: async () => context.alarm,
          setAlarm: async (when) => {
            context.alarm = when;
            context.arms++;
          },
        },
      };
      contexts.set(name, context);
    }
    if (!objects.has(name)) objects.set(name, new RunnerService(contexts.get(name), env));
    return objects.get(name);
  };
  env.RUNNERS = { idFromName: (id) => id, getByName: get };
  return {
    env,
    name,
    get,
    contexts,
    evict(name) {
      objects.delete(name);
    },
    async alarm(name) {
      const object = get(name);
      contexts.get(name).alarm = null;
      await object.alarm();
    },
  };
}

void test("direct wakes arm independent slots without waiting for a parent alarm and honor pause", async (t) => {
  const f = runnerNamespace(),
    root = f.get(f.name),
    active = f.env.RUNNER_CONTROL;
  const dispatch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(new URL(url).pathname, "/internal/runner/drain");
    assert.equal(JSON.parse(init.body).singleAttempt, true);
    return Response.json({ queued: 0, running: 0 });
  });
  const wake = (origin, token) =>
    worker.fetch(
      new Request(`${origin}/internal/wake`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
      f.env,
    );
  const direct = "https://runner-wake.internal";
  assert.equal((await wake(direct, secret("x"))).status, 404);
  assert.equal((await wake(f.env.DRAIN_ORIGIN, f.env.QUOREM_RUNNER_DRAIN_SECRET)).status, 404);
  assert.equal((await wake(direct, f.env.QUOREM_RUNNER_DRAIN_SECRET)).status, 204);
  const slots = [...f.contexts.keys()].filter((name) => name !== f.name);
  assert.equal(slots.length, 8);
  assert.ok(slots.every((name) => f.contexts.get(name).alarm !== null));
  assert.equal(dispatch.mock.callCount(), 0);
  assert.equal((await wake(direct, f.env.QUOREM_RUNNER_DRAIN_SECRET)).status, 204);
  assert.equal(f.contexts.get(f.name).arms, 1);
  f.contexts.get(f.name).alarm = Date.now() + 30000;
  await wake(direct, f.env.QUOREM_RUNNER_DRAIN_SECRET);
  assert.ok(f.contexts.get(f.name).alarm <= Date.now());
  f.env.RUNNER_CONTROL = {
    getByName: () => ({ fetch: async () => new Response(null, { status: 503 }) }),
  };
  const armed = slots.map((name) => f.contexts.get(name).arms);
  assert.equal((await wake(direct, f.env.QUOREM_RUNNER_DRAIN_SECRET)).status, 503);
  await f.alarm(f.name);
  assert.deepEqual(
    slots.map((name) => f.contexts.get(name).arms),
    armed,
  );
  f.env.RUNNER_CONTROL = active;
  await f.alarm(f.name);
  assert.equal(dispatch.mock.callCount(), 0);
  await Promise.all(slots.map((name) => f.alarm(name)));
  assert.equal(dispatch.mock.callCount(), 8);
  await root.fetch(new Request(`${f.env.DRAIN_ORIGIN}/internal/pause`, { method: "POST" }));
  f.evict(f.name);
  await f.alarm(f.name);
  await f.alarm(slots[0]);
  assert.equal(dispatch.mock.callCount(), 8);
});

void test("an interrupted direct fanout leaves the parent alarm for recovery", async () => {
  const f = runnerNamespace(),
    root = f.get(f.name),
    original = root.wakeChildren.bind(root);
  root.wakeChildren = async () => {
    throw new Error("fixture interrupted");
  };
  assert.equal((await root.fetch(root.command("wake"))).status, 503);
  assert.ok(f.contexts.get(f.name).alarm !== null);
  assert.equal(f.contexts.size, 1);
  root.wakeChildren = original;
  await f.alarm(f.name);
  assert.equal(f.contexts.size, 9);
});

void test("a failed slot durably halts future namespace work after eviction", async (t) => {
  const f = runnerNamespace();
  await f.alarm(f.name);
  const slot = [...f.contexts.keys()].find((name) => name !== f.name);
  const dispatch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ failure: { kind: "teardown" } }, { status: 503 }),
  );
  await assert.rejects(f.alarm(slot), /Runner wake drain failed/);
  assert.equal(f.contexts.get(f.name).values.get("teardown-failed"), true);
  f.evict(f.name);
  f.evict(slot);
  await f.alarm(f.name);
  await f.alarm(slot);
  assert.equal(dispatch.mock.callCount(), 1);
});

void test("an incomplete slot persists its next alarm before returning", async (t) => {
  const f = runnerNamespace();
  await f.alarm(f.name);
  const slot = [...f.contexts.keys()].find((name) => name !== f.name);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ queued: 1, running: 0 }, { status: 202 }),
  );
  await f.alarm(slot);
  assert.ok(f.contexts.get(slot).alarm !== null);
});

void test("queue fallback schedules slots without an aggregate drain and confirms authoritative emptiness", async (t) => {
  const f = runnerNamespace(),
    root = f.get(f.name);
  let state = { queued: 8, running: 0 },
    empty = false;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const operation = new URL(url).pathname.split("/").pop();
    calls.push(operation);
    assert.equal(init.headers.authorization, `Bearer ${f.env.QUOREM_RUNNER_COMMAND_SECRET}`);
    assert.equal(init.body, "{}");
    assert.ok(["state", "empty"].includes(operation));
    return Response.json(operation === "state" ? state : empty);
  });
  const request = () => root.command("drain");
  assert.equal((await root.fetch(request())).status, 202);
  assert.ok(f.contexts.get(f.name).alarm !== null);
  assert.deepEqual(calls, ["state"]);
  state = { queued: 0, running: 0 };
  assert.equal((await root.fetch(request())).status, 202);
  empty = true;
  f.contexts.get(f.name).alarm = null;
  assert.equal((await root.fetch(request())).status, 200);
  assert.equal(f.contexts.get(f.name).alarm, null);
  assert.deepEqual(calls, ["state", "state", "empty", "state", "empty"]);
  state = { queued: -1, running: 0 };
  assert.equal((await root.fetch(request())).status, 503);
});

void test("a finished slot does not poll other live attempts", async (t) => {
  const f = runnerNamespace();
  await f.alarm(f.name);
  const slot = [...f.contexts.keys()].find((name) => name !== f.name);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ queued: 0, running: 7 }, { status: 202 }),
  );
  await f.alarm(slot);
  assert.equal(f.contexts.get(slot).alarm, null);
});

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
    .update(JSON.stringify([env.CASE_ORIGIN, namespace, fingerprint, "attempt-vm-v1"]))
    .digest("hex")}`;
  const controlScope = `remote:${createHash("sha256")
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
  const deniedCase = await post();
  assert.equal(deniedCase.status, 200);
  await assert.rejects(deniedCase.arrayBuffer(), /Case admission unavailable/);
  assert.deepEqual(events.splice(0), ["control:/register"]);
  registered = true;
  const acceptedCase = await post();
  assert.equal(acceptedCase.status, 200);
  assert.equal(await acceptedCase.text(), "\x01\0\0\0\0\0\0\0ok");
  assert.deepEqual(events.splice(0), ["control:/register", "case"]);
  const control = env.CASE_CONTROL;
  let releaseGate;
  const gatePending = new Promise((resolve) => {
    releaseGate = resolve;
  });
  env.CASE_CONTROL = {
    getByName: () => ({
      fetch: async () => {
        events.push("control:pending");
        await gatePending;
        return new Response(null, { status: 204 });
      },
    }),
  };
  let timer;
  try {
    const early = await Promise.race([
      post(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), 1000);
      }),
    ]);
    assert.equal(early?.status, 200);
    const reader = early.body.getReader();
    assert.deepEqual(
      (await reader.read()).value,
      new Uint8Array(8).fill(0).map((n, i) => (i === 0 ? 1 : n)),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["control:pending"]);
    // Cancellation before durable admission must never launch a native case afterward.
    await reader.cancel();
    releaseGate();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events.splice(0), ["control:pending"]);
  } finally {
    clearTimeout(timer);
    releaseGate();
    env.CASE_CONTROL = control;
  }
  const adminCase = (token, ownerScope = controlScope) =>
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
          "x-quorem-owner-scope": controlScope,
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
      scope: controlScope,
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
    scope: controlScope,
    attempt: "runner-control",
    nonce: runnerNonce,
    value: { generation: 1, status: "active", release: null, bindings: null },
  });
  await assert.rejects(
    verifyCaseProbe(invalidSigned, {
      publicKey,
      kind: "runner-control-state",
      scope: controlScope,
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
    404,
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
    .update(JSON.stringify([env.CASE_ORIGIN, namespace, fingerprint, "attempt-vm-v1"]))
    .digest("hex")}`;
  const values = new Map();
  const context = {
    storage: {
      transaction(run) {
        const pending = (context.transaction ?? Promise.resolve()).then(() => run(context.storage));
        context.transaction = pending.catch(() => {});
        return pending;
      },
      async get(key) {
        return values.get(key);
      },
      async put(key, value) {
        if (typeof key === "object")
          for (const [name, item] of Object.entries(key)) values.set(name, item);
        else values.set(key, value);
      },
      async delete(key) {
        for (const name of Array.isArray(key) ? key : [key]) values.delete(name);
      },
      async setAlarm() {},
      async deleteAlarm() {},
    },
    waitUntil() {},
    container: {
      images: { python: "fixture" },
      async inspect() {
        return { image: "fixture", labels: {} };
      },
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
      if (id !== attempt) {
        assert.ok(
          Array.from({ length: 7 }, (_, index) => index + 1).some(
            (lane) => id === `${attempt}-lane-${lane}`,
          ),
        );
        return {
          fetch: async (request) =>
            request.method === "GET"
              ? Response.json({ active: false, running: false, ordinal: null, tokenHash: null })
              : new Response(null, { status: 204 }),
        };
      }
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
  const reader = started.body.getReader();
  await reader.read();
  reader.releaseLock();
  for (let tick = 0; tick < 100 && sandbox.phase !== "exec-ready"; tick++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sandbox.phase, "exec-ready");
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
  const { timing, ...diagnosticState } = await diagnosticResponse.json();
  assert.ok(Number.isSafeInteger(timing.startupMs));
  assert.deepEqual(diagnosticState, {
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
    .update(JSON.stringify([env.CASE_ORIGIN, namespace, fingerprint, "attempt-vm-v1"]))
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
    .update(JSON.stringify([env.CASE_ORIGIN, secret("0"), fingerprint, "attempt-vm-v1"]))
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
  const drain = () =>
    new Request(`${env.DRAIN_ORIGIN}/internal/drain`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.QUOREM_RUNNER_DRAIN_SECRET}` },
    });
  assert.equal((await new RunnerService(context, env).fetch(pause())).status, 204);
  assert.equal((await new RunnerService(context, env).fetch(drain())).status, 503);
  assert.equal((await new RunnerService(context, env).fetch(pause())).status, 204);
});

void test("runner timings require the drain credential and survive eviction", async () => {
  const env = base();
  const profile = {
    elapsedMs: 42,
    metrics: { "sandbox.runCase": { calls: 1, totalMs: 20, maxMs: 20 } },
  };
  const context = {
    storage: { get: async (key) => (key === "last-profile" ? profile : undefined) },
    waitUntil() {},
  };
  const request = (authorized) =>
    new Request(`${env.DRAIN_ORIGIN}/internal/profile`, {
      method: "POST",
      headers: authorized ? { authorization: `Bearer ${env.QUOREM_RUNNER_DRAIN_SECRET}` } : {},
    });
  assert.equal((await new RunnerService(context, env).fetch(request(false))).status, 401);
  assert.deepEqual(
    await (await new RunnerService(context, env).fetch(request(true))).json(),
    profile,
  );
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

void test("authenticated mail health starts the trusted relay with only its runtime configuration", async () => {
  const env = {
    ...base(),
    MAIL_RELAY_ENABLED: "true",
    MAIL_RELAY_ORIGIN: "https://mail-stage.example.test",
    MAIL_RELAY_TOKEN: secret("m"),
    AUTH_EMAIL_FROM: "Quorem <fixture@example.test>",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "465",
    SMTP_USERNAME: "fixture",
    SMTP_PASSWORD: "fixture-password",
  };
  const starts = [],
    targets = [];
  let running = false;
  const relay = new MailRelayService(
    {
      waitUntil() {},
      container: {
        get running() {
          return running;
        },
        start(options) {
          starts.push(options);
          running = true;
        },
        async setInactivityTimeout() {},
        monitor() {
          return new Promise(() => {});
        },
        getTcpPort(port) {
          assert.equal(port, 8092);
          return {
            async fetch(input) {
              targets.push(new URL(input instanceof Request ? input.url : input).pathname);
              return new Response(null, { status: 204 });
            },
          };
        },
      },
    },
    env,
  );
  env.MAIL = { getByName: () => ({ fetch: (request) => relay.fetch(request) }) };
  const probe = (token) =>
    worker.fetch(
      new Request(`${env.MAIL_RELAY_ORIGIN}/internal/mail/health`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
    );
  assert.equal((await probe(secret("z"))).status, 404);
  assert.equal(starts.length, 0);
  assert.equal((await probe(env.MAIL_RELAY_TOKEN)).status, 204);
  assert.equal(starts.length, 1);
  assert.deepEqual(targets, ["/health", "/health"]);
  assert.deepEqual(Object.keys(starts[0].env).sort(), [
    "APP_ENV",
    "AUTH_EMAIL_FROM",
    "MAIL_RELAY_LISTEN",
    "MAIL_RELAY_TOKEN",
    "SMTP_HOST",
    "SMTP_PASSWORD",
    "SMTP_PORT",
    "SMTP_USERNAME",
  ]);
  assert.equal(starts[0].env.MAIL_RELAY_TOKEN, env.MAIL_RELAY_TOKEN);
  assert.equal(starts[0].enableInternet, true);
});
