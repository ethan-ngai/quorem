/// <reference types="@cloudflare/vitest-plugin/types" />
import { expect, it } from "vitest";
import { env as runtimeEnv } from "cloudflare:test";
import worker from "../../../../../deploy/hono/services/worker.js";
import { verifyCaseProbe } from "../../../../../deploy/case-proof.js";
const secret = (value: string) => value.repeat(64);
const controls = {
  RECOVERY_CONTROL_SECRET: secret("r"),
  SERVICES_RELEASE: "a".repeat(40),
  SERVICES_GENERATION: "1",
  SERVICES_BINDINGS: secret("9"),
  RUNNER_CONTROL: {
    getByName: () => ({
      fetch: async () =>
        Response.json({
          generation: 1,
          release: "a".repeat(40),
          bindings: secret("9"),
          runner: `runner:${"a".repeat(40)}:1`,
        }),
    }),
  },
  CASE_CONTROL: { getByName: () => ({ fetch: async () => new Response(null, { status: 204 }) }) },
};
it("enforces scoped hosts and attests large valid case ordinals in workerd", async () => {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
  let forwarded: Request | undefined;
  const env = {
    ...controls,
    DRAIN_ORIGIN: "https://runner-stage.example.test",
    VERIFIER_ORIGIN: "https://verify-stage.example.test",
    CASE_ORIGIN: "https://case-stage.example.test",
    QUOREM_CASE_ORIGIN: "https://case-stage.example.test",
    QUOREM_RUNNER_COMMAND_SECRET: secret("a"),
    QUOREM_RUNNER_DRAIN_SECRET: secret("b"),
    QUOREM_CASE_SECRET: secret("c"),
    QUOREM_VERIFICATION_SOURCE_KEY: secret("d"),
    QUOREM_VERIFICATION_SERVICE_KEY: secret("e"),
    QUOREM_CASE_OWNER_PUBLIC_KEY_PEM: `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki))}\n-----END PUBLIC KEY-----`,
    QUOREM_CASE_NAMESPACE_ID: secret("1"),
    CASE_DIAGNOSTICS: "true",
    QUOREM_VERIFICATION_SIGNING_KEY_PEM: "private key",
    CASE_OWNER_PRIVATE_KEY: btoa(String.fromCharCode(...pkcs8)),
    CASES: {
      idFromName: () => secret("1"),
      getByName: () => ({
        fetch: async (request: Request) => {
          forwarded = request;
          return request.method === "DELETE"
            ? new Response(null, { status: 204 })
            : request.method === "GET"
              ? Response.json({ active: true, running: true, ordinal: 400, tokenHash: secret("2") })
              : new Response("ok");
        },
      }),
    },
  };
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", spki)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const scoped = new TextEncoder().encode(
    JSON.stringify([env.CASE_ORIGIN, secret("1"), fingerprint]),
  );
  const scope = `remote:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", scoped)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const body = "case bytes",
    bytes = new TextEncoder().encode(body);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const nonce = crypto.randomUUID();
  const request = new Request(`${env.CASE_ORIGIN}/internal/case/attempt-1`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
      "cf-access-client-secret": "must-strip",
      "x-quorem-owner-nonce": nonce,
      "x-quorem-owner-scope": scope,
      "x-quorem-case-binding": secret("1"),
      "x-quorem-body-sha256": digest,
      "x-quorem-case-ordinal": "400",
    },
    body,
  });
  const response = await worker.fetch(request, env);
  expect(response.status).toBe(200);
  expect(response.headers.get("x-quorem-owner-signature")).toBeTruthy();
  const signature = Uint8Array.from(atob(response.headers.get("x-quorem-owner-signature")!), (c) =>
    c.charCodeAt(0),
  );
  const attested = JSON.stringify([
    scope,
    secret("1"),
    "POST",
    "attempt-1",
    "",
    200,
    nonce,
    secret("1"),
    digest,
    "400",
    "",
    "",
    "",
  ]);
  expect(
    await crypto.subtle.verify(
      "Ed25519",
      keys.publicKey,
      signature,
      new TextEncoder().encode(attested),
    ),
  ).toBe(true);
  const namespaceNonce = crypto.randomUUID();
  const namespaceResponse = await worker.fetch(
    new Request(`${env.CASE_ORIGIN}/internal/case/namespace`, {
      headers: {
        authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
        "x-quorem-owner-nonce": namespaceNonce,
      },
    }),
    env,
  );
  expect(
    await verifyCaseProbe(namespaceResponse, {
      publicKey: keys.publicKey,
      kind: "namespace",
      scope: "",
      attempt: "namespace",
      nonce: namespaceNonce,
    }),
  ).toEqual({ namespace: secret("1") });
  const probeNonce = crypto.randomUUID();
  const probe = await worker.fetch(
    new Request(`${env.CASE_ORIGIN}/internal/case/attempt-1`, {
      headers: {
        authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
        "x-quorem-owner-nonce": probeNonce,
        "x-quorem-owner-scope": scope,
        "x-quorem-case-probe": "lifecycle",
      },
    }),
    env,
  );
  expect(
    await verifyCaseProbe(probe, {
      publicKey: keys.publicKey,
      kind: "lifecycle",
      scope,
      attempt: "attempt-1",
      nonce: probeNonce,
      expectedNamespace: secret("1"),
    }),
  ).toEqual({ active: true, running: true, ordinal: 400, tokenHash: secret("2") });
  const actualCases = (
    runtimeEnv as unknown as {
      TEST_CASES: {
        idFromName(name: string): { toString(): string };
        getByName(name: string): { fetch(request: Request): Promise<Response> };
      };
    }
  ).TEST_CASES;
  const actualNamespace = actualCases.idFromName("quorem-sandbox-namespace-v1").toString();
  const actualScopeBytes = new TextEncoder().encode(
    JSON.stringify([env.CASE_ORIGIN, actualNamespace, fingerprint]),
  );
  const actualScope = `remote:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", actualScopeBytes)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const actualEnv = { ...env, CASES: actualCases, QUOREM_CASE_NAMESPACE_ID: actualNamespace };
  const actualNonce = crypto.randomUUID();
  const actualProbe = await worker.fetch(
    new Request(`${env.CASE_ORIGIN}/internal/case/real-idle`, {
      headers: {
        authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
        "x-quorem-owner-nonce": actualNonce,
        "x-quorem-owner-scope": actualScope,
        "x-quorem-case-probe": "lifecycle",
      },
    }),
    actualEnv,
  );
  expect(
    await verifyCaseProbe(actualProbe, {
      publicKey: keys.publicKey,
      kind: "lifecycle",
      scope: actualScope,
      attempt: "real-idle",
      nonce: actualNonce,
      expectedNamespace: actualNamespace,
    }),
  ).toEqual({ active: false, running: false, ordinal: null, tokenHash: null });
  const deleteNonce = crypto.randomUUID();
  const deleted = await worker.fetch(
    new Request(`${env.CASE_ORIGIN}/internal/case/real-idle`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
        "x-quorem-owner-nonce": deleteNonce,
        "x-quorem-owner-scope": scope,
      },
    }),
    env,
  );
  expect(deleted.status).toBe(204);
  const deleteSignature = Uint8Array.from(
    atob(deleted.headers.get("x-quorem-owner-signature")!),
    (c) => c.charCodeAt(0),
  );
  expect(
    await crypto.subtle.verify(
      "Ed25519",
      keys.publicKey,
      deleteSignature,
      new TextEncoder().encode(
        JSON.stringify([
          scope,
          secret("1"),
          "DELETE",
          "real-idle",
          "",
          204,
          deleteNonce,
          "",
          "",
          "",
          "",
          "",
          "",
        ]),
      ),
    ),
  ).toBe(true);
  expect(forwarded?.headers.get("authorization")).toBeNull();
  expect(forwarded?.headers.get("cf-access-client-secret")).toBeNull();
  forwarded = undefined;
  const remove = (ownerScope: string) =>
    new Request(`${env.CASE_ORIGIN}/internal/case/attempt-1`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${env.QUOREM_CASE_SECRET}`,
        "x-quorem-owner-nonce": crypto.randomUUID(),
        "x-quorem-owner-scope": ownerScope,
      },
    });
  expect(
    (await worker.fetch(remove(scope), { ...env, QUOREM_CASE_NAMESPACE_ID: secret("0") })).status,
  ).toBe(503);
  expect((await worker.fetch(remove(`remote:${secret("3")}`), env)).status).toBe(503);
  expect(forwarded).toBeUndefined();
  expect(
    (
      await worker.fetch(
        new Request("https://alternate.example.test/internal/drain", {
          method: "POST",
          headers: { authorization: `Bearer ${env.QUOREM_RUNNER_DRAIN_SECRET}` },
        }),
        env,
      )
    ).status,
  ).toBe(404);
});

it("real control objects block paused case posts and unactivated drains", async () => {
  const bindings = runtimeEnv as unknown as {
    CASES: { idFromName(name: string): { toString(): string } };
    CASE_CONTROL: {
      getByName(name: string): { fetch(url: string, init: RequestInit): Promise<Response> };
    };
    RUNNER_CONTROL: {
      getByName(name: string): { fetch(url: string, init: RequestInit): Promise<Response> };
    };
  };
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  const namespace = bindings.CASES.idFromName("quorem-sandbox-namespace-v1").toString();
  const digestHex = async (value: Uint8Array) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(value))), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const origin = "https://case-stage.example.test";
  const scope = `remote:${await digestHex(new TextEncoder().encode(JSON.stringify([origin, namespace, await digestHex(spki)])))}`;
  const control = bindings.CASE_CONTROL.getByName("case-control"),
    operation = crypto.randomUUID();
  const controlPost = (path: string, body: unknown) =>
    control.fetch(`https://case-control.internal${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  const genesis = { namespace, scope, operation, release: controls.SERVICES_RELEASE };
  expect((await controlPost("/initialize", genesis)).status).toBe(204);
  expect(
    (
      await controlPost("/activate", {
        operation: crypto.randomUUID(),
        release: genesis.release,
        bindings: controls.SERVICES_BINDINGS,
        expectedGeneration: 0,
      })
    ).status,
  ).toBe(204);
  let forwarded = 0;
  const env = {
    ...controls,
    DRAIN_ORIGIN: "https://runner-stage.example.test",
    VERIFIER_ORIGIN: "https://verify-stage.example.test",
    CASE_ORIGIN: origin,
    QUOREM_CASE_ORIGIN: origin,
    QUOREM_RUNNER_COMMAND_SECRET: secret("a"),
    QUOREM_RUNNER_DRAIN_SECRET: secret("b"),
    QUOREM_CASE_SECRET: secret("c"),
    QUOREM_VERIFICATION_SOURCE_KEY: secret("d"),
    QUOREM_VERIFICATION_SERVICE_KEY: secret("e"),
    QUOREM_CASE_OWNER_PUBLIC_KEY_PEM: `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki))}\n-----END PUBLIC KEY-----`,
    QUOREM_CASE_NAMESPACE_ID: namespace,
    QUOREM_VERIFICATION_SIGNING_KEY_PEM: "key",
    CASE_OWNER_PRIVATE_KEY: btoa(String.fromCharCode(...pkcs8)),
    CASE_CONTROL: bindings.CASE_CONTROL,
    RUNNER_CONTROL: bindings.RUNNER_CONTROL,
    CASES: {
      idFromName: () => namespace,
      getByName: () => ({
        fetch: async () => {
          forwarded++;
          return new Response("ok");
        },
      }),
    },
  };
  const body = "fixture",
    bodyHash = await digestHex(new TextEncoder().encode(body));
  const post = (token: string | null = env.QUOREM_CASE_SECRET) =>
    worker.fetch(
      new Request(`${origin}/internal/case/attempt-1`, {
        method: "POST",
        headers: {
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
          "x-quorem-owner-scope": scope,
          "x-quorem-owner-nonce": crypto.randomUUID(),
          "x-quorem-case-binding": secret("2"),
          "x-quorem-body-sha256": bodyHash,
          "x-quorem-case-ordinal": "0",
        },
        body,
      }),
      env,
    );
  expect((await post(null)).status).toBe(404);
  expect((await post(secret("z"))).status).toBe(404);
  expect(forwarded).toBe(0);
  expect((await post()).status).toBe(200);
  expect(forwarded).toBe(1);
  expect(
    (await controlPost("/pause", { operation: crypto.randomUUID(), expectedGeneration: 1 })).status,
  ).toBe(204);
  expect((await post()).status).toBe(503);
  expect(forwarded).toBe(1);
  const drain = await worker.fetch(
    new Request(`${env.DRAIN_ORIGIN}/internal/drain`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.QUOREM_RUNNER_DRAIN_SECRET}` },
    }),
    env,
  );
  expect(drain.status).toBe(503);
  const nonce = crypto.randomUUID();
  const stateRequest = () =>
    new Request(`${env.DRAIN_ORIGIN}/internal/control/runner/state`, {
      headers: {
        authorization: `Bearer ${env.RECOVERY_CONTROL_SECRET}`,
        "x-quorem-owner-scope": scope,
        "x-quorem-owner-nonce": nonce,
      },
    });
  const state = await worker.fetch(stateRequest(), env);
  const proof = {
    publicKey: keys.publicKey,
    kind: "runner-control-state",
    scope,
    attempt: "runner-control",
    nonce,
    expectedNamespace: namespace,
  };
  expect(await verifyCaseProbe(state.clone(), proof)).toEqual({
    generation: 0,
    status: "paused",
    release: null,
    bindings: null,
  });
  await expect(
    verifyCaseProbe(state.clone(), { ...proof, nonce: crypto.randomUUID() }),
  ).rejects.toThrow();
  await expect(
    verifyCaseProbe(state.clone(), { ...proof, scope: `remote:${secret("8")}` }),
  ).rejects.toThrow();
  await expect(
    verifyCaseProbe(state.clone(), { ...proof, kind: "control-state", attempt: "control" }),
  ).rejects.toThrow();
  const tampered = new Response(
    JSON.stringify({ generation: 1, status: "paused", release: null, bindings: null }),
    { status: 200, headers: state.headers },
  );
  await expect(verifyCaseProbe(tampered, proof)).rejects.toThrow();
  const malformed = {
    ...env,
    RUNNER_CONTROL: {
      getByName: () => ({
        fetch: async () =>
          Response.json({ generation: 1, status: "active", release: null, bindings: null }),
      }),
    },
  };
  expect((await worker.fetch(stateRequest(), malformed)).status).toBe(503);
});

it("routes optional media with purpose bearer in workerd", async () => {
  let forwarded: Request | undefined;
  const env = {
    ...controls,
    DRAIN_ORIGIN: "https://runner-stage.example.test",
    VERIFIER_ORIGIN: "https://verify-stage.example.test",
    CASE_ORIGIN: "https://case-stage.example.test",
    QUOREM_CASE_ORIGIN: "https://case-stage.example.test",
    QUOREM_RUNNER_COMMAND_SECRET: secret("a"),
    QUOREM_RUNNER_DRAIN_SECRET: secret("b"),
    QUOREM_CASE_SECRET: secret("c"),
    QUOREM_VERIFICATION_SOURCE_KEY: secret("d"),
    QUOREM_VERIFICATION_SERVICE_KEY: secret("e"),
    QUOREM_CASE_OWNER_PUBLIC_KEY_PEM: "key",
    QUOREM_VERIFICATION_SIGNING_KEY_PEM: "key",
    CASE_OWNER_PRIVATE_KEY: "key",
    IMAGE_SERVICE_ENABLED: "true",
    IMAGE_ORIGIN: "https://image-stage.example.test",
    IMAGE_SERVICE_TOKEN: secret("i"),
    IMAGES: {
      getByName: () => ({
        fetch: async (request: Request) => {
          forwarded = request;
          return new Response("image", { headers: { "x-image-execution": "terminated" } });
        },
      }),
    },
  };
  const request = (token: string) =>
    new Request(env.IMAGE_ORIGIN, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "cf-access-client-secret": "discard" },
    });
  const response = await worker.fetch(request(env.IMAGE_SERVICE_TOKEN), env);
  expect(response.headers.get("x-image-execution")).toBe("terminated");
  expect(forwarded?.headers.get("cf-access-client-secret")).toBeNull();
  expect((await worker.fetch(request(secret("z")), env)).status).toBe(404);
});

it("persists runner pause in Durable Object storage", async () => {
  const binding = (
    runtimeEnv as unknown as {
      TEST_RUNNERS: {
        idFromName(name: string): unknown;
        get(id: unknown): { fetch(url: string, init: RequestInit): Promise<Response> };
      };
    }
  ).TEST_RUNNERS;
  const runner = binding.get(binding.idFromName(crypto.randomUUID()));
  expect((await runner.fetch("https://service/internal/pause", { method: "POST" })).status).toBe(
    204,
  );
  expect((await runner.fetch("https://service/internal/drain", { method: "POST" })).status).toBe(
    503,
  );
});

it("uses native workerd Request options for private container readiness", async () => {
  const { ContainerLifecycle } = await import("../../../../../deploy/container.js");
  const paths: string[] = [];
  const lifecycle = new ContainerLifecycle(
    {
      waitUntil() {},
      container: {
        running: true,
        setInactivityTimeout: async () => {},
        monitor: () => new Promise(() => {}),
        getTcpPort: () => ({
          async fetch(input: string | Request, init?: RequestInit) {
            const request = new Request(input, init);
            paths.push(new URL(request.url).pathname);
            return new Response(null, { status: paths.length === 1 ? 200 : 204 });
          },
        }),
      },
    },
    {},
    8090,
    1,
  );
  const response = await lifecycle.forward(
    new Request("https://runner-stage.example.test/internal/drain", { method: "POST" }),
  );
  expect(response.status).toBe(204);
  expect(paths).toEqual(["/health", "/internal/drain"]);
});

it("pins Access credentials and rejects redirects with native workerd requests", async () => {
  const { accessFetch } = await import("@quorem/execution/transport/access");
  let calls = 0;
  const send: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    expect(request.redirect).toBe("manual");
    expect(request.headers.get("CF-Access-Client-Secret")).toBe("fixture-access-secret");
    return new Response(null, {
      status: ++calls === 1 ? 204 : 302,
      headers: { location: "https://other.example" },
    });
  };
  const wrapped = accessFetch(
    "https://private.example",
    { id: "fixture-access-id", secret: "fixture-access-secret" },
    send,
  )!;
  expect((await wrapped("https://private.example/internal")).status).toBe(204);
  await expect(wrapped("https://private.example/internal")).rejects.toThrow("redirect rejected");
  expect(calls).toBe(2);
});
