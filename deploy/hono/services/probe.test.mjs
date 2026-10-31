import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { signedCaseProbe } from "../../case-proof.js";
import { probeNamespace } from "./probe.mjs";

void test("namespace bootstrap pins Access, bearer, nonce, key and origin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quorem-probe-test-"));
  try {
    const keys = generateKeyPairSync("ed25519"),
      file = join(directory, "public.pem");
    await writeFile(file, keys.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
    const env = {
      QUOREM_CASE_ORIGIN: "https://case-stage.example.test",
      QUOREM_CASE_SECRET: "c".repeat(64),
      QUOREM_CASE_OWNER_PUBLIC_KEY_FILE: file,
      QUOREM_CASE_ACCESS_CLIENT_ID: "case-id",
      QUOREM_CASE_ACCESS_CLIENT_SECRET: "case-access-secret",
    };
    const signer = {
      CASE_OWNER_PRIVATE_KEY: keys.privateKey
        .export({ type: "pkcs8", format: "der" })
        .toString("base64"),
      CASES: { idFromName: () => "1".repeat(64) },
    };
    const send = async (url, init) => {
      assert.equal(url.origin, env.QUOREM_CASE_ORIGIN);
      assert.equal(init.redirect, "error");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("cf-access-client-id"), env.QUOREM_CASE_ACCESS_CLIENT_ID);
      assert.equal(headers.get("cf-access-client-secret"), env.QUOREM_CASE_ACCESS_CLIENT_SECRET);
      assert.equal(headers.get("authorization"), `Bearer ${env.QUOREM_CASE_SECRET}`);
      return signedCaseProbe(signer, {
        kind: "namespace",
        scope: "",
        attempt: "namespace",
        nonce: headers.get("x-quorem-owner-nonce"),
        value: { namespace: "1".repeat(64) },
      });
    };
    assert.deepEqual(await probeNamespace(env, send), { namespace: "1".repeat(64) });
    await writeFile(
      file,
      generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }),
    );
    await assert.rejects(probeNamespace(env, send));
    await assert.rejects(
      probeNamespace({ ...env, QUOREM_CASE_ORIGIN: "http://example.test" }, send),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
