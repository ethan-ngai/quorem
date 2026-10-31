import { bytesInput } from "./input.ts";
/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { defaultLimits } from "@quorem/execution";
import worker from "../../../../deploy/worker.js";
import { remoteSandbox } from "./remote.ts";
function frame(channel: number, value: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + value.length);
  out[0] = channel;
  new DataView(out.buffer).setUint32(4, value.length);
  out.set(value, 8);
  return out;
}
void test("actual ingress signs durable namespace identity for case execution and deletion", async () => {
  const secret = "fixture-only-case-service-token-123456",
    key = generateKeyPairSync("ed25519"),
    namespace = "c".repeat(64);
  let deletes = 0;
  const env = {
    APP_ORIGIN: "https://fixture.invalid",
    JUDGE_CONTROL_TOKEN: secret,
    CASE_OWNER_PRIVATE_KEY: key.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
    CASES: {
      idFromName: () => ({ toString: () => namespace }),
      getByName: () => ({
        fetch: async (req: Request) => {
          if (req.method === "DELETE") {
            deletes++;
            return new Response(null, { status: 204 });
          }
          const parts = [
            frame(1, new Uint8Array([0, 65])),
            frame(3, new Uint8Array(4)),
            frame(4, new Uint8Array()),
          ];
          return new Response(
            new ReadableStream({
              start(c) {
                for (const p of parts) c.enqueue(p);
                c.close();
              },
            }),
          );
        },
      }),
    },
  };
  const sandbox = remoteSandbox({
    origin: env.APP_ORIGIN,
    secret,
    namespaceId: namespace,
    ownerPublicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
    cleanupMs: 500,
    fetch: (input, init) => worker.fetch(new Request(input, init), env),
  });
  const fence = { attemptId: "fixture-attempt", sandboxScope: sandbox.scope };
  assert.deepEqual(
    [
      ...(
        await sandbox.runCase({
          fence,
          binding: "a".repeat(64),
          ordinal: 0,
          language: "python",
          limits: defaultLimits(),
          input: bytesInput(new Uint8Array([1])),
          outputLimit: 65536,
          timeoutMs: 1000,
        })
      ).stdout,
    ],
    [0, 65],
  );
  await sandbox.teardownAttempt(fence);
  assert.equal(deletes, 1);
  const different = remoteSandbox({
    origin: env.APP_ORIGIN,
    secret,
    namespaceId: "d".repeat(64),
    ownerPublicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
    cleanupMs: 500,
    fetch: (input, init) => worker.fetch(new Request(input, init), env),
  });
  await assert.rejects(
    different.teardownAttempt({ attemptId: "fixture-attempt", sandboxScope: different.scope }),
    /unconfirmed/,
  );
  const tampered = remoteSandbox({
    origin: env.APP_ORIGIN,
    secret,
    namespaceId: namespace,
    ownerPublicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
    cleanupMs: 500,
    fetch: (input, init) =>
      worker.fetch(
        new Request(input, {
          ...init,
          ...(init?.method === "POST" ? { body: new Uint8Array([2]) } : {}),
        }),
        env,
      ),
  });
  await assert.rejects(
    tampered.runCase({
      fence: { attemptId: "fixture-tamper", sandboxScope: tampered.scope },
      binding: "a".repeat(64),
      ordinal: 0,
      language: "python",
      limits: defaultLimits(),
      input: bytesInput(new Uint8Array([1])),
      outputLimit: 65536,
      timeoutMs: 1000,
    }),
    /unavailable/,
  );
});
