/// <reference types="node" />
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { once } from "node:events";
import {
  defaultLimits,
  verifyResultReceipt,
  type ExecutionInputReader,
  type Job,
} from "@quorem/execution";
import { nodeResultVerifier, type VerificationSource } from "./verifier.ts";
const job: Job = {
  jobId: "job",
  submissionId: "submission",
  problemVersionId: "problem",
  sourceRef: "source",
  suiteRef: "suite",
  language: "python",
  runtimeRevision: "python-3.12-v1",
  harnessRevision: "quorem-harness-v2",
  attemptId: "attempt",
  sandboxScope: "scope",
  limits: defaultLimits(),
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function setup(actual = "8") {
  const metadata = new TextEncoder().encode('{"signature":{"returnType":"int"}}');
  const testcase = new TextEncoder().encode('{"args":[],"expected":7}');
  const ref = { hash: hash(testcase), size: testcase.length, channel: "public" as const };
  const manifest = {
    kind: "run" as const,
    level: null,
    caseCount: 1,
    sampleCount: 0,
    privateDetails: false,
    submitCasesAreSamples: false,
    source: { hash: "a".repeat(64), size: 1 },
    metadata: { hash: hash(metadata), size: metadata.length },
    suiteHash: "b".repeat(64),
  };
  const inputs: ExecutionInputReader = {
    async inputManifest() {
      return manifest;
    },
    async inputCaseRef() {
      return ref;
    },
    async inputPage(_job, kind, _ordinal, offset) {
      const bytes = kind === "metadata" ? metadata : testcase;
      return {
        bytes: bytes.subarray(offset, offset + 65536),
        size: bytes.length,
        hash: hash(bytes),
        channel: kind === "case" ? "public" : null,
      };
    },
  };
  const fields = new Map<string, string>();
  const source: VerificationSource = {
    inputs,
    async frozenCase(challenge) {
      return {
        challenge,
        job,
        ordinal: 0,
        frameHash: "c".repeat(64),
        status: "accepted",
        actual: {
          hash: hash(new TextEncoder().encode(actual)),
          size: new TextEncoder().encode(actual).length,
        },
        sqlTypes: null,
      };
    },
    async fieldPage(_challenge, field, offset) {
      if (field !== "actual") throw new Error("Missing field");
      const bytes = new TextEncoder().encode(actual);
      return {
        bytes: bytes.subarray(offset, offset + 65536),
        hash: hash(bytes),
        size: bytes.length,
        channel: null,
      };
    },
    async putField(_challenge, field, chunks) {
      const values: Uint8Array[] = [];
      for await (const chunk of chunks) values.push(chunk);
      fields.set(field, Buffer.concat(values).toString("utf8"));
    },
  };
  return { source, fields, inputs };
}
void test("compares admitted expected value and signs bound fields, rejecting forged outcomes", async () => {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const { source, fields } = setup();
  const { receipt, signature } = await nodeResultVerifier(source, keys.privateKey)("challenge");
  assert.equal(receipt.status, "wrong_answer");
  assert.equal(fields.get("expected"), "7");
  assert.equal(fields.get("actual"), "8");
  assert.equal(await verifyResultReceipt(receipt, signature, keys.publicKey), true);
  assert.equal(
    await verifyResultReceipt({ ...receipt, status: "accepted" }, signature, keys.publicKey),
    false,
  );
  assert.equal(
    await verifyResultReceipt({ ...receipt, attemptId: "other" }, signature, keys.publicKey),
    false,
  );
});
void test("refuses changed case bytes and source outages", async () => {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const { source, inputs } = setup();
  const page = inputs.inputPage.bind(inputs);
  inputs.inputPage = async (...args) => {
    const result = await page(...args);
    return args[1] === "case"
      ? { ...result, bytes: new TextEncoder().encode("x".repeat(result.bytes.length)) }
      : result;
  };
  await assert.rejects(nodeResultVerifier(source, keys.privateKey)("challenge"), /digest mismatch/);
  inputs.inputManifest = async () => {
    throw new Error("offline");
  };
  await assert.rejects(nodeResultVerifier(source, keys.privateKey)("challenge"), /offline/);
});

void test("private HTTP service authenticates callers and returns a verifiable derived receipt", async () => {
  const { createServer } = await import("node:http");
  const { verificationHandler } = await import("./http.ts");
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const { source } = setup();
  const credential = new Uint8Array(32).fill(7);
  const server = createServer(
    verificationHandler({
      credential,
      verify: nodeResultVerifier(source, keys.privateKey),
      timeoutMs: 2000,
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/internal/results/verify`;
    assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${Buffer.from(credential).toString("hex")}` },
      body: JSON.stringify({ challenge: "challenge" }),
    });
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      receipt: import("@quorem/execution").VerificationReceipt;
      signature: string;
    };
    assert.equal(result.receipt.status, "wrong_answer");
    assert.equal(
      await verifyResultReceipt(
        result.receipt,
        Buffer.from(result.signature, "base64"),
        keys.publicKey,
      ),
      true,
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});
void test("SQL type mismatch is independently derived and signed", async () => {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const { source, inputs } = setup('{"rows":[[{"$numeric":"1"}]]}');
  const metadata = new TextEncoder().encode(
    '{"signature":{"returnType":"int"},"sql":{"dialect":"postgresql","outputOrder":"ordered","output":[{"name":"n","type":"numeric"}]}}',
  );
  const testcase = new TextEncoder().encode('{"args":[],"expected":{"rows":[[{"$numeric":"1"}]]}}');
  const previousManifest = inputs.inputManifest.bind(inputs);
  inputs.inputManifest = async (job, signal) => ({
    ...(await previousManifest(job, signal)),
    metadata: { hash: hash(metadata), size: metadata.length },
  });
  inputs.inputCaseRef = async () => ({
    hash: hash(testcase),
    size: testcase.length,
    channel: "public",
  });
  inputs.inputPage = async (_job, kind, _ordinal, offset) => {
    const data = kind === "metadata" ? metadata : testcase;
    return {
      bytes: data.subarray(offset, offset + 65536),
      hash: hash(data),
      size: data.length,
      channel: kind === "case" ? "public" : null,
    };
  };
  const frozen = source.frozenCase.bind(source);
  const sqlTypes = new TextEncoder().encode('["text"]');
  source.frozenCase = async (id, signal) => ({
    ...(await frozen(id, signal)),
    sqlTypes: { hash: hash(sqlTypes), size: sqlTypes.length },
  });
  const field = source.fieldPage.bind(source);
  source.fieldPage = async (id, name, offset, signal) =>
    name === "sqlTypes"
      ? {
          bytes: sqlTypes.subarray(offset, offset + 65536),
          hash: hash(sqlTypes),
          size: sqlTypes.length,
          channel: null,
        }
      : field(id, name, offset, signal);
  const { receipt, signature } = await nodeResultVerifier(source, keys.privateKey)("challenge");
  assert.equal(receipt.status, "wrong_answer");
  assert.equal(receipt.typeMismatch, true);
  assert.equal(
    await verifyResultReceipt({ ...receipt, typeMismatch: false }, signature, keys.publicKey),
    false,
  );
});
