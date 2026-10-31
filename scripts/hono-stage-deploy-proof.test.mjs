import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageNamespace } from "./hono-stage-deploy-proof.mjs";

void test("pins only verified namespace to canonical scope and rejects drift", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quorem-stage-proof-"));
  try {
    const key = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
    const file = join(dir, "public.pem");
    await writeFile(file, key);
    const env = {
      QUOREM_CASE_ORIGIN: "https://case-stage.example",
      QUOREM_CASE_SECRET: "x".repeat(32),
      QUOREM_CASE_OWNER_PUBLIC_KEY_FILE: file,
    };
    const probe = async () => ({ namespace: "a".repeat(64) });
    const first = await stageNamespace(env, "0".repeat(64), probe);
    assert.match(first.scope, /^remote:[0-9a-f]{64}$/);
    assert.deepEqual(await stageNamespace(env, first.namespace, probe), first);
    await assert.rejects(stageNamespace(env, "b".repeat(64), probe), /changed/);
    await assert.rejects(
      stageNamespace(env, "0".repeat(64), async () => ({ namespace: "0".repeat(64) })),
      /Invalid signed/,
    );
    await assert.rejects(
      stageNamespace(env, "0".repeat(64), async () => {
        throw new Error("bad signature");
      }),
      /bad signature/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
