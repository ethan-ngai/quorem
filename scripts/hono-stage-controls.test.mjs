import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signedCaseProbe, readVerifiedCaseProbe, verifyCaseProbe } from "../deploy/case-proof.js";
import { stageControls } from "./hono-stage-controls.mjs";
async function fixture() {
  const keys = generateKeyPairSync("ed25519"),
    dir = await mkdtemp(join(tmpdir(), "stage-control-test-"));
  const publicKeyFile = join(dir, "public.pem");
  await writeFile(publicKeyFile, keys.publicKey.export({ type: "spki", format: "pem" }));
  const namespace = "1".repeat(64),
    scope = `remote:${"2".repeat(64)}`,
    release = "a".repeat(40),
    bindings = "b".repeat(64),
    token = randomUUID();
  const options = {
    namespace,
    scope,
    release,
    bindings,
    secret: "s".repeat(64),
    caseOrigin: "https://case-stage.example.com",
    runnerOrigin: "https://runner-stage.example.com",
    caseAccess: { id: "case", secret: "case-secret" },
    runnerAccess: { id: "runner", secret: "runner-secret" },
    publicKeyFile,
  };
  const env = {
    CASES: { idFromName: () => namespace },
    CASE_OWNER_PRIVATE_KEY: keys.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
  };
  let runner = { generation: 0, status: "paused", release: null, bindings: null },
    cases,
    failAction = "",
    calls = [];
  const send = async (raw, init) => {
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.authorization, `Bearer ${options.secret}`);
    const url = new URL(raw),
      parts = url.pathname.split("/"),
      kind = parts[3],
      action = parts[4];
    calls.push(`${kind}:${action}`);
    if (`${kind}:${action}` === failAction) throw new Error("fixture transport failure");
    if (action === "state")
      return signedCaseProbe(env, {
        kind: kind === "case" ? "control-state" : "runner-control-state",
        scope,
        attempt: kind === "case" ? "control" : "runner-control",
        nonce: init.headers["x-quorem-owner-nonce"],
        value: kind === "case" ? cases : runner,
      });
    const input = JSON.parse(init.body);
    if (kind === "runner" && action === "prepare") {
      runner = { generation: 1, status: "prepared", release, bindings };
      return Response.json({ ...runner, token });
    }
    if (kind === "runner" && action === "activate") {
      assert.equal(input.token, token);
      runner.status = "active";
    }
    if (kind === "runner" && action === "pause") runner.status = "paused";
    if (kind === "case" && action === "initialize")
      cases = {
        namespace,
        scope,
        initialOperation: input.operation,
        initialRelease: release,
        generation: 0,
        release: null,
        bindings: null,
        activationOperation: null,
        pauseOperation: null,
        paused: true,
      };
    if (kind === "case" && action === "activate")
      Object.assign(cases, {
        generation: 1,
        release,
        bindings,
        activationOperation: input.operation,
        paused: false,
      });
    if (kind === "case" && action === "pause")
      Object.assign(cases, { paused: true, pauseOperation: input.operation });
    return new Response(null, { status: 204 });
  };
  return {
    options,
    send,
    calls,
    fail: (action) => {
      failAction = action;
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
void test("activates and checks signed state after each step without disclosing token", async () => {
  const f = await fixture();
  try {
    const control = await stageControls(f.options, f.send);
    const receipt = await control.activate();
    assert.equal(receipt.generation, 1);
    assert.equal("token" in receipt, false);
    assert.equal(receipt.proofs.length, 8);
    assert.ok(receipt.proofs.every((proof) => proof.signature && proof.body && proof.nonce));
    assert.equal(JSON.stringify(receipt).includes(f.options.secret), false);
    await control.pause();
    assert.ok(f.calls.includes("case:pause"));
    assert.ok(f.calls.includes("runner:pause"));
  } finally {
    await f.cleanup();
  }
});
void test("failed activation never returns a receipt and uncertain pause fails closed", async () => {
  const f = await fixture();
  try {
    const control = await stageControls(f.options, f.send);
    f.fail("case:activate");
    await assert.rejects(control.activate());
    f.fail("case:state");
    await assert.rejects(control.pause(), /unconfirmed/);
  } finally {
    await f.cleanup();
  }
});

void test("forged runner state fails closed", async () => {
  const f = await fixture();
  try {
    const control = await stageControls(f.options, async (url, init) => {
      const response = await f.send(url, init);
      if (url.endsWith("/runner/state")) {
        const headers = new Headers(response.headers);
        headers.set("x-quorem-owner-signature", `${"A".repeat(86)}==`);
        return new Response(response.body, { status: response.status, headers });
      }
      return response;
    });
    await assert.rejects(control.activate(), /probe/);
    assert.deepEqual(f.calls, ["runner:state"]);
  } finally {
    await f.cleanup();
  }
});

void test("proof capture reads once, bounds cancellation and supports offline verification", async () => {
  const keys = generateKeyPairSync("ed25519"),
    namespace = "1".repeat(64),
    nonce = randomUUID();
  const env = {
    CASES: { idFromName: () => namespace },
    CASE_OWNER_PRIVATE_KEY: keys.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
  };
  const publicKey = await crypto.subtle.importKey(
    "spki",
    keys.publicKey.export({ type: "spki", format: "der" }),
    "Ed25519",
    false,
    ["verify"],
  );
  const options = {
    publicKey,
    kind: "namespace",
    scope: "",
    attempt: "namespace",
    nonce,
    expectedNamespace: namespace,
  };
  const signed = () =>
    signedCaseProbe(env, {
      kind: "namespace",
      scope: "",
      attempt: "namespace",
      nonce,
      value: { namespace },
    });
  const { value, envelope } = await readVerifiedCaseProbe(await signed(), options);
  assert.deepEqual(value, { namespace });
  const offline = new Response(Buffer.from(envelope.body, "base64"), {
    headers: {
      "x-quorem-owner-namespace": envelope.namespace,
      "x-quorem-owner-signature": envelope.signature,
    },
  });
  assert.deepEqual(
    await verifyCaseProbe(offline, {
      publicKey,
      kind: envelope.kind,
      scope: envelope.scope,
      attempt: envelope.attempt,
      nonce: envelope.nonce,
      expectedNamespace: envelope.namespace,
    }),
    value,
  );
  const headers = (await signed()).headers;
  let cancelled = 0;
  const oversized = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1025));
      },
      cancel() {
        cancelled++;
        return new Promise(() => {});
      },
    }),
    { headers },
  );
  await Promise.race([
    assert.rejects(readVerifiedCaseProbe(oversized, options), /probe/),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("proof read did not terminate")), 1000),
    ),
  ]);
  assert.equal(cancelled, 1);
  const forgedHeaders = new Headers(headers);
  forgedHeaders.set("x-quorem-owner-signature", `${"A".repeat(86)}==`);
  await assert.rejects(
    readVerifiedCaseProbe(
      new Response(JSON.stringify({ namespace }), { headers: forgedHeaders }),
      options,
    ),
    /probe/,
  );
});

void test("stage control rejects an oversized nonending proof without waiting on a tee", async () => {
  const f = await fixture();
  let cancelled = 0;
  try {
    const control = await stageControls(f.options, async (url, init) => {
      const response = await f.send(url, init);
      if (!url.endsWith("/runner/state")) return response;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1025));
          },
          cancel() {
            cancelled++;
            return new Promise(() => {});
          },
        }),
        { headers: response.headers },
      );
    });
    await Promise.race([
      assert.rejects(control.activate(), /probe/),
      new Promise((_, reject) => setTimeout(() => reject(new Error("stage control hung")), 1000)),
    ]);
    assert.equal(cancelled, 1);
  } finally {
    await f.cleanup();
  }
});
