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
    signer: env,
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

void test("pinned recovery controls replay lost acknowledgments across generations", async () => {
  const f = await fixture();
  try {
    const initialOperation = randomUUID(),
      initialRelease = "1".repeat(40),
      oldRelease = "2".repeat(40),
      oldBindings = "3".repeat(64),
      token = randomUUID();
    const prior = {
      generation: 2,
      release: oldRelease,
      bindings: oldBindings,
      initialOperation,
      initialRelease,
    };
    let runner = { generation: 2, status: "active", release: oldRelease, bindings: oldBindings };
    let cases = {
      namespace: f.options.namespace,
      scope: f.options.scope,
      initialOperation,
      initialRelease,
      generation: 2,
      release: oldRelease,
      bindings: oldBindings,
      activationOperation: randomUUID(),
      pauseOperation: null,
      paused: false,
    };
    const operations = new Map(),
      lost = new Set([
        "runner:pause",
        "case:pause",
        "runner:prepare",
        "case:activate",
        "runner:activate",
      ]);
    const send = async (raw, init) => {
      const url = new URL(raw),
        parts = url.pathname.split("/"),
        kind = parts[3],
        action = parts[4],
        nonce = init.headers["x-quorem-owner-nonce"];
      if (action === "state")
        return signedCaseProbe(f.signer, {
          kind: kind === "case" ? "control-state" : "runner-control-state",
          scope: f.options.scope,
          attempt: kind === "case" ? "control" : "runner-control",
          nonce,
          value: kind === "case" ? cases : runner,
        });
      if (action === "inventory")
        return signedCaseProbe(f.signer, {
          kind: "control-inventory",
          scope: f.options.scope,
          attempt: "control",
          nonce,
          value: {
            after: url.searchParams.get("after") ?? "",
            attempts: ["attempt-1"],
            next: null,
          },
        });
      const body = JSON.parse(init.body),
        id = body.operationId ?? body.operation,
        name = `${kind}:${action}`,
        fingerprint = JSON.stringify([name, body]);
      let receipt = operations.get(id);
      if (receipt) {
        assert.equal(receipt.fingerprint, fingerprint);
        return receipt.response();
      }
      let response = () => new Response(null, { status: 204 });
      if (name === "runner:pause") runner = { ...runner, status: "paused" };
      if (name === "case:pause") cases = { ...cases, paused: true, pauseOperation: id };
      if (name === "runner:prepare") {
        runner = {
          generation: body.expectedGeneration + 1,
          status: "prepared",
          release: body.release,
          bindings: body.bindings,
        };
        const preparedReceipt = { ...runner, token };
        response = () => Response.json(preparedReceipt);
      }
      if (name === "case:activate")
        cases = {
          ...cases,
          generation: body.expectedGeneration + 1,
          paused: false,
          release: body.release,
          bindings: body.bindings,
          activationOperation: id,
          pauseOperation: null,
        };
      if (name === "runner:activate") {
        assert.equal(body.token, token);
        runner = { ...runner, status: "active" };
      }
      operations.set(id, { fingerprint, response });
      if (lost.delete(name)) throw new Error("fixture lost acknowledgment");
      return response();
    };
    const controls = await stageControls(f.options, send),
      runnerOperation = randomUUID(),
      caseOperation = randomUUID();
    f.signer.CASES = { idFromName: () => "f".repeat(64) };
    await assert.rejects(controls.observe(), /probe/);
    f.signer.CASES = { idFromName: () => f.options.namespace };
    assert.equal((await controls.observe()).runner.generation, 2);
    assert.deepEqual((await controls.inventoryPage()).attempts, ["attempt-1"]);
    await assert.rejects(controls.pausePinned({ prior, runnerOperation, caseOperation }));
    assert.equal((await controls.observe()).cases.paused, true);
    assert.equal(
      (await controls.pausePinned({ prior, runnerOperation, caseOperation })).cases.paused,
      true,
    );
    await assert.rejects(controls.prepareResume({ prior, operation: "bad" }), /operation/);
    await assert.rejects(
      controls.prepareResume({
        prior: { ...prior, release: "f".repeat(40) },
        operation: randomUUID(),
      }),
      /state/,
    );
    const prepare = randomUUID();
    await assert.rejects(controls.prepareResume({ prior, operation: prepare }));
    const prepared = await controls.prepareResume({ prior, operation: prepare });
    assert.equal(prepared.token, token);
    const caseActivate = randomUUID();
    await assert.rejects(controls.activateCaseResume({ prior, operation: caseActivate }));
    assert.equal(
      (await controls.activateCaseResume({ prior, operation: caseActivate })).cases.generation,
      3,
    );
    assert.equal(
      (await controls.prepareResume({ prior, operation: prepare, caseOperation: caseActivate }))
        .token,
      token,
    );
    const runnerActivate = randomUUID();
    await assert.rejects(
      controls.activateRunnerResume({
        prior,
        operation: runnerActivate,
        caseOperation: caseActivate,
        token,
      }),
    );
    assert.equal(
      (
        await controls.activateRunnerResume({
          prior,
          operation: runnerActivate,
          caseOperation: caseActivate,
          token,
        })
      ).runner.generation,
      3,
    );
    const replay = await controls.prepareResume({
      prior,
      operation: prepare,
      caseOperation: caseActivate,
    });
    await controls.activateCaseResume({ prior, operation: caseActivate });
    assert.equal(
      (
        await controls.activateRunnerResume({
          prior,
          operation: runnerActivate,
          caseOperation: caseActivate,
          token: replay.token,
        })
      ).runner.status,
      "active",
    );
    await assert.rejects(
      controls.pausePinned({ prior, runnerOperation, caseOperation }),
      /unconfirmed/,
    );
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

void test("unavailable runner state does not prevent independently pausing the case authority", async () => {
  const f = await fixture();
  try {
    const prior = {
      generation: 2,
      release: "2".repeat(40),
      bindings: "3".repeat(64),
      initialOperation: randomUUID(),
      initialRelease: "1".repeat(40),
    };
    let paused = false,
      calls = 0;
    const caseOperation = randomUUID();
    const controls = await stageControls(f.options, async (raw, init) => {
      const parts = new URL(raw).pathname.split("/"),
        kind = parts[3],
        action = parts[4];
      if (kind === "runner") throw new Error("runner unavailable");
      if (action === "pause") {
        calls++;
        paused = true;
        return new Response(null, { status: 204 });
      }
      return signedCaseProbe(f.signer, {
        kind: "control-state",
        scope: f.options.scope,
        attempt: "control",
        nonce: init.headers["x-quorem-owner-nonce"],
        value: {
          namespace: f.options.namespace,
          scope: f.options.scope,
          initialOperation: prior.initialOperation,
          initialRelease: prior.initialRelease,
          generation: prior.generation,
          release: prior.release,
          bindings: prior.bindings,
          activationOperation: randomUUID(),
          pauseOperation: paused ? caseOperation : null,
          paused,
        },
      });
    });
    await assert.rejects(
      controls.pausePinned({ prior, runnerOperation: randomUUID(), caseOperation }),
      /unconfirmed/,
    );
    assert.equal(paused, true);
    assert.equal(calls, 1);
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
