/** @file access.test.ts @description Pinned private ingress transport. @module execution */
import { test } from "vitest";
import assert from "node:assert/strict";
import { accessFetch } from "./access.ts";
test("private ingress attaches credentials only to the pinned HTTPS origin", async () => {
  let sent = 0;
  const send: typeof fetch = async (_input, init) => {
    sent++;
    assert.equal(init?.redirect, "manual");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer application");
    assert.equal(headers.get("cf-access-client-id"), "fixture-id");
    assert.equal(headers.get("cf-access-client-secret"), "fixture-secret");
    return new Response(null, { status: 204 });
  };
  const wrapped = accessFetch(
    "https://api.example",
    { id: "fixture-id", secret: "fixture-secret" },
    send,
  )!;
  await wrapped("https://api.example/internal", {
    headers: { authorization: "Bearer application" },
  });
  await wrapped(
    new Request("https://api.example/internal", {
      headers: { authorization: "Bearer application" },
    }),
  );
  await assert.rejects(wrapped("https://api.example.evil/internal"));
  await assert.rejects(wrapped("https://user:password@api.example/internal"));
  await assert.rejects(wrapped("https://api.example/internal#fragment"));
  await assert.rejects(wrapped("https://other.example/internal"));
  await assert.rejects(wrapped("http://api.example/internal"));
  await assert.rejects(
    wrapped("https://api.example/internal", { headers: { "CF-Access-Client-Secret": "other" } }),
  );
  assert.equal(sent, 2);
  assert.throws(() => accessFetch("https://api.example/prefix", { id: "x", secret: "y" }, send));
  assert.equal(accessFetch("https://api.example", undefined, send), undefined);
});
