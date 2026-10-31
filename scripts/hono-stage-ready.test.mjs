import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stageNamespaceReady } from "./hono-stage-ready.mjs";
import { signedCaseProbe } from "../deploy/case-proof.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "namespace-ready-")),
    keys = generateKeyPairSync("ed25519"),
    file = join(dir, "public.pem"),
    namespace = "a".repeat(64);
  await writeFile(file, keys.publicKey.export({ type: "spki", format: "pem" }));
  return {
    dir,
    namespace,
    env: {
      QUOREM_CASE_ORIGIN: "https://case-stage.example.com",
      QUOREM_CASE_SECRET: "s".repeat(64),
      QUOREM_CASE_ACCESS_CLIENT_ID: "id",
      QUOREM_CASE_ACCESS_CLIENT_SECRET: "access",
      QUOREM_CASE_OWNER_PUBLIC_KEY_FILE: file,
    },
    signer: {
      CASES: { idFromName: () => namespace },
      CASE_OWNER_PRIVATE_KEY: keys.privateKey
        .export({ type: "pkcs8", format: "der" })
        .toString("base64"),
    },
  };
}
void test("retries only transient GET failures with fresh proof nonce", async () => {
  const f = await fixture();
  try {
    let calls = 0,
      cancelled = 0,
      time = 0;
    const nonces = [];
    const send = async (url, init) => {
      assert.equal(new URL(url).pathname, "/internal/case/namespace");
      assert.ok(init.signal);
      assert.equal(init.redirect, "error");
      const headers = new Headers(init.headers);
      nonces.push(headers.get("x-quorem-owner-nonce"));
      calls++;
      if (calls === 1) throw new Error("private fixture transport detail");
      if (calls === 2)
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
          { status: 403 },
        );
      return signedCaseProbe(f.signer, {
        kind: "namespace",
        scope: "",
        attempt: "namespace",
        nonce: nonces.at(-1),
        value: { namespace: f.namespace },
      });
    };
    const result = await stageNamespaceReady(f.env, "0".repeat(64), {
      send,
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      timeoutMs: 100,
      intervalMs: 2,
    });
    assert.equal(result.namespace, f.namespace);
    assert.equal(calls, 3);
    assert.equal(cancelled, 1);
    assert.equal(new Set(nonces).size, 3);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
void test("invalid 200 proof and changed namespace fail once; transient deadline is bounded", async () => {
  const f = await fixture();
  try {
    let calls = 0,
      time = 0;
    const options = {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      timeoutMs: 5,
      intervalMs: 2,
    };
    await assert.rejects(
      stageNamespaceReady(f.env, "0".repeat(64), {
        ...options,
        send: async () => {
          calls++;
          return Response.json({ namespace: f.namespace });
        },
      }),
      /probe/,
    );
    assert.equal(calls, 1);
    calls = 0;
    await assert.rejects(
      stageNamespaceReady(f.env, "b".repeat(64), {
        ...options,
        send: async (_url, init) => {
          calls++;
          return signedCaseProbe(f.signer, {
            kind: "namespace",
            scope: "",
            attempt: "namespace",
            nonce: new Headers(init.headers).get("x-quorem-owner-nonce"),
            value: { namespace: f.namespace },
          });
        },
      }),
      /changed/,
    );
    assert.equal(calls, 1);
    calls = 0;
    await assert.rejects(
      stageNamespaceReady(f.env, "0".repeat(64), {
        ...options,
        send: async () => {
          calls++;
          return new Response(null, { status: 503 });
        },
      }),
      /timed out/,
    );
    assert.equal(calls, 3);
    assert.equal(time, 5);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
