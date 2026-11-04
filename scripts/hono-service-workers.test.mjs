import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";

const api = createRequire(new URL("../apps/api/package.json", import.meta.url));
const execution = createRequire(new URL("../apps/runner/package.json", import.meta.url))(
  "@quorem/execution",
);
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  api.resolve("wrangler/package.json"),
)("miniflare");
const modules = (name) => [
  {
    type: "ESModule",
    path: new URL(`../deploy/hono/services/dist/${name}.js`, import.meta.url).pathname,
  },
];
const compatibilityDate = "2026-10-25";
const compatibilityFlags = ["nodejs_compat"];
const blob = (data) => {
  const bytes = Buffer.from(data);
  return {
    bytes: bytes.toString("base64"),
    hash: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  };
};

test("native verifier reads frozen pages, derives the verdict and signs it", async () => {
  const keys = generateKeyPairSync("ed25519");
  const origin = "https://verify.example.test";
  const sourceKey = "a".repeat(64),
    serviceKey = "b".repeat(64);
  const meta = blob('{"signature":{"returnType":"int"}}');
  const testcase = blob(JSON.stringify({ args: [], expected: 7, padding: "x".repeat(1 << 20) }));
  const actual = blob("8");
  const ref = ({ hash, size }) => ({ hash, size });
  const fields = new Map();
  const page = (value, offset, channel) => ({
    ...ref(value),
    channel,
    bytes: Buffer.from(value.bytes, "base64")
      .subarray(offset, offset + 65536)
      .toString("base64"),
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: modules("worker-verifier"),
      compatibilityDate,
      compatibilityFlags,
      bindings: {
        VERIFIER_ORIGIN: origin,
        QUOREM_VERIFICATION_SOURCE_ORIGIN: "https://api.example.test",
        QUOREM_VERIFICATION_SOURCE_KEY: sourceKey,
        QUOREM_VERIFICATION_SERVICE_KEY: serviceKey,
        QUOREM_VERIFICATION_SIGNING_KEY_PEM: keys.privateKey.export({
          type: "pkcs8",
          format: "pem",
        }),
      },
      async outboundService(request) {
        assert.equal(request.headers.get("authorization"), `Bearer ${sourceKey}`);
        const input = await request.json();
        assert.equal(input.challenge, "challenge");
        switch (new URL(request.url).pathname.split("/").at(-1)) {
          case "frozen":
            return Response.json({
              challenge: input.challenge,
              job: {
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
                limits: {
                  wallTimeMs: 1000,
                  memoryBytes: 100000000,
                  maxProcesses: 1,
                  outputBytes: 65536,
                  maxCollectionElements: 1000,
                  maxNestingDepth: 32,
                },
              },
              ordinal: 0,
              frameHash: "c".repeat(64),
              status: "accepted",
              actual: ref(actual),
              sqlTypes: null,
            });
          case "manifest":
            return Response.json({
              kind: "run",
              level: null,
              caseCount: 1,
              sampleCount: 0,
              privateDetails: false,
              submitCasesAreSamples: false,
              source: { hash: "a".repeat(64), size: 1 },
              metadata: ref(meta),
              suiteHash: "b".repeat(64),
            });
          case "ref":
            return Response.json({ ...ref(testcase), channel: "public" });
          case "page":
            return Response.json(
              input.kind === "metadata"
                ? page(meta, input.offset, null)
                : page(testcase, input.offset, "public"),
            );
          case "field":
            return Response.json({ ...actual, channel: null });
          case "output":
            fields.set(input.field, Buffer.from(input.bytes, "base64").toString());
            return Response.json(true);
          default:
            throw new Error("Unexpected verification command");
        }
      },
    }),
  );
  try {
    const call = (token) =>
      mf.dispatchFetch(`${origin}/internal/results/verify`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: '{"challenge":"challenge"}',
      });
    assert.equal((await call(sourceKey)).status, 401);
    const result = await call(serviceKey);
    assert.equal(result.status, 200, await result.clone().text());
    const { receipt, signature } = await result.json();
    assert.equal(receipt.status, "wrong_answer");
    assert.equal(
      verify(
        null,
        execution.verificationReceiptBytes(receipt),
        keys.publicKey,
        Buffer.from(signature, "base64"),
      ),
      true,
    );
    assert.deepEqual(
      fields,
      new Map([
        ["actual", "8"],
        ["expected", "7"],
      ]),
    );
  } finally {
    await mf.dispose();
  }
});

test(
  "native runner drains through the private command API with no container binding",
  { timeout: 25000 },
  async () => {
    const key = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
    const drainSecret = "d".repeat(64),
      commandSecret = "c".repeat(64);
    const calls = [];
    let fail = true;
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: modules("worker"),
        compatibilityDate,
        compatibilityFlags,
        durableObjects: { RUNNERS: { className: "RunnerService", useSQLite: true } },
        bindings: {
          QUOREM_CASE_ORIGIN: "https://case.example.test",
          QUOREM_CASE_NAMESPACE_ID: "a".repeat(64),
          QUOREM_CASE_SECRET: "e".repeat(64),
          QUOREM_CASE_OWNER_PUBLIC_KEY_PEM: key,
          QUOREM_RUNNER_COMMAND_ORIGIN: "https://api.example.test",
          QUOREM_RUNNER_COMMAND_SECRET: commandSecret,
          QUOREM_RUNNER_DRAIN_SECRET: drainSecret,
        },
        async outboundService(request) {
          assert.equal(request.headers.get("authorization"), `Bearer ${commandSecret}`);
          const op = new URL(request.url).pathname.split("/").at(-1);
          calls.push(op);
          if (op === "expired") return Response.json(null);
          if (fail) return new Response(null, { status: 503 });
          if (op === "claim" || op === "deadline") return Response.json(null);
          if (op === "state") return Response.json({ queued: 0, running: 0 });
          if (op === "empty") return Response.json(true);
          throw new Error("Unexpected runner command");
        },
      }),
    );
    try {
      const ns = await mf.getDurableObjectNamespace("RUNNERS");
      const runner = ns.get(ns.idFromName("runner:test"));
      const send = (path, token) =>
        runner.fetch(`https://runner.example.test/internal/${path}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
      assert.equal((await send("drain", commandSecret)).status, 401);
      const response = await send("drain", drainSecret);
      assert.equal(response.status, 503);
      const { failure, command } = await response.json();
      assert.equal(failure.kind, "command");
      assert.equal(command.status, 503);
      assert.ok(calls.includes("expired"));
      fail = false;
      const drained = await send("drain", drainSecret);
      assert.equal(drained.status, 200);
      assert.deepEqual(await drained.json(), { queued: 0, running: 0 });
      assert.ok(calls.includes("claim"));
      assert.ok(calls.includes("empty"));
      assert.equal((await send("pause", drainSecret)).status, 204);
      calls.length = 0;
      assert.equal((await send("drain", drainSecret)).status, 503);
      assert.deepEqual(calls, []);
    } finally {
      await mf.dispose();
    }
  },
);
