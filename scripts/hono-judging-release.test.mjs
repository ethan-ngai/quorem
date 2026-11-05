import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  judgingPeerSecret,
  judgingScopeIdle,
  judgingScopeCompatible,
} from "./hono-judging-release.mjs";
void test("scope changes bind the deployed private release, namespace and runner credential", () => {
  const keys = {
    QUOREM_CASE_SECRET: "c".repeat(64),
    QUOREM_RUNNER_COMMAND_SECRET: "r".repeat(64),
    QUOREM_CASE_OWNER_PUBLIC_KEY_PEM: generateKeyPairSync("ed25519").publicKey.export({
      type: "spki",
      format: "pem",
    }),
  };
  const service = {
    SERVICES_RELEASE: "a".repeat(40),
    QUOREM_CASE_ORIGIN: "https://case-hono.quorem.app",
    QUOREM_CASE_NAMESPACE_ID: "b".repeat(64),
  };
  const [peer] = JSON.parse(judgingPeerSecret(keys, service, service.SERVICES_RELEASE));
  assert.equal(peer.secret, keys.QUOREM_RUNNER_COMMAND_SECRET);
  assert.equal(peer.resumable, true);
  assert.match(peer.scope, /^remote:[a-f0-9]{64}$/);
  for (const changes of [
    { SERVICES_RELEASE: "d".repeat(40) },
    { QUOREM_CASE_ORIGIN: "https://other.test" },
    { QUOREM_CASE_NAMESPACE_ID: "0".repeat(64) },
  ])
    assert.throws(() =>
      judgingPeerSecret(keys, { ...service, ...changes }, service.SERVICES_RELEASE),
    );
});
void test("scope transition fails closed unless the authoritative database confirms idle", async () => {
  for (const rows of [[], [{ idle: false }], [{ idle: null }]])
    assert.equal(await judgingScopeIdle({ query: async () => ({ rows }) }), false);
  assert.equal(
    await judgingScopeIdle({
      query: async (text) => {
        assert.match(text, /execution_checkpoints/);
        assert.match(text, /attempt_id IS NOT NULL/);
        return { rows: [{ idle: true }] };
      },
    }),
    true,
  );
});

void test("same-protocol recovery rejects any foreign attempt scope and missing database proof", async () => {
  const scope = `remote:${"a".repeat(64)}`;
  for (const rows of [[], [{ compatible: false }], [{ compatible: null }]])
    assert.equal(await judgingScopeCompatible({ query: async () => ({ rows }) }, scope), false);
  assert.equal(
    await judgingScopeCompatible(
      {
        query: async (text, values) => {
          assert.deepEqual(values, [scope]);
          assert.match(text, /sandbox_scope<>\$1/);
          return { rows: [{ compatible: true }] };
        },
      },
      scope,
    ),
    true,
  );
  await assert.rejects(judgingScopeCompatible({}, "invalid"));
});
