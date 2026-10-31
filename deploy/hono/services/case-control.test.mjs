import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { CaseControl } from "./case-control.js";
import { verifyCaseProbe } from "../../case-proof.js";

test("genesis, pause and bounded authenticated inventory survive recreation", async () => {
  const keys = generateKeyPairSync("ed25519"),
    namespace = "a".repeat(64);
  const env = {
    CASES: { idFromName: () => namespace },
    CASE_OWNER_PRIVATE_KEY: keys.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
  };
  const key = await crypto.subtle.importKey(
    "spki",
    keys.publicKey.export({ type: "spki", format: "der" }),
    "Ed25519",
    false,
    ["verify"],
  );
  const values = new Map();
  const storage = {
    get: async (k) => values.get(k),
    put: async (k, v) => values.set(k, structuredClone(v)),
    transaction: async (fn) => fn(storage),
    list: async ({ prefix, startAfter = "", limit }) =>
      new Map(
        [...values]
          .filter(([k]) => k.startsWith(prefix) && k > startAfter)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .slice(0, limit),
      ),
  };
  let control = new CaseControl({ storage }, env);
  const call = (path, value) =>
    control.fetch(
      new Request(`https://private${path}`, { method: "POST", body: JSON.stringify(value) }),
    );
  const genesis = {
    namespace,
    scope: `remote:${"b".repeat(64)}`,
    operation: randomUUID(),
    release: "c".repeat(40),
  };
  assert.equal((await call("/register", { attempt: "a" })).status, 503);
  assert.equal((await call("/initialize", genesis)).status, 204);
  assert.equal((await call("/register", { attempt: "a" })).status, 503);
  assert.equal((await call("/activate", genesis)).status, 204);
  for (const attempt of ["a", "b", "c", "d", "e"])
    assert.equal((await call("/register", { attempt })).status, 204);
  assert.equal((await call("/pause", genesis)).status, 204);
  assert.equal((await call("/register", { attempt: "a" })).status, 503);
  assert.equal((await call("/activate", genesis)).status, 409);
  control = new CaseControl({ storage }, env);
  assert.equal((await call("/initialize", { ...genesis, release: "d".repeat(40) })).status, 409);
  const nonce = randomUUID();
  const response = await control.fetch(
    new Request("https://private/inventory?limit=4", {
      headers: { "x-quorem-owner-scope": genesis.scope, "x-quorem-owner-nonce": nonce },
    }),
  );
  const options = {
    publicKey: key,
    kind: "control-inventory",
    scope: genesis.scope,
    attempt: "control",
    nonce,
    expectedNamespace: namespace,
    expectedAfter: "",
  };
  const page = await verifyCaseProbe(response.clone(), options);
  assert.deepEqual(page, { after: "", attempts: ["a", "b", "c", "d"], next: "d" });
  await assert.rejects(verifyCaseProbe(response.clone(), { ...options, nonce: randomUUID() }));
  await assert.rejects(verifyCaseProbe(response.clone(), { ...options, expectedAfter: "a" }));
  const other = generateKeyPairSync("ed25519");
  const wrongKey = await crypto.subtle.importKey(
    "spki",
    other.publicKey.export({ type: "spki", format: "der" }),
    "Ed25519",
    false,
    ["verify"],
  );
  await assert.rejects(verifyCaseProbe(response.clone(), { ...options, publicKey: wrongKey }));
  await assert.rejects(
    verifyCaseProbe(response.clone(), { ...options, expectedNamespace: "f".repeat(64) }),
  );
  await assert.rejects(
    verifyCaseProbe(response, { ...options, scope: `remote:${"f".repeat(64)}` }),
  );
  const nonce2 = randomUUID();
  const last = await control.fetch(
    new Request("https://private/inventory?after=d&limit=4", {
      headers: { "x-quorem-owner-scope": genesis.scope, "x-quorem-owner-nonce": nonce2 },
    }),
  );
  assert.deepEqual(await verifyCaseProbe(last, { ...options, nonce: nonce2, expectedAfter: "d" }), {
    after: "d",
    attempts: ["e"],
    next: null,
  });
  const stateNonce = randomUUID();
  const state = await control.fetch(
    new Request("https://private/state", {
      headers: { "x-quorem-owner-scope": genesis.scope, "x-quorem-owner-nonce": stateNonce },
    }),
  );
  assert.deepEqual(
    await verifyCaseProbe(state, {
      publicKey: key,
      kind: "control-state",
      scope: genesis.scope,
      attempt: "control",
      nonce: stateNonce,
      expectedNamespace: namespace,
    }),
    { ...genesis, paused: true, halted: true },
  );
});
