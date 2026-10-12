/** @file policy.test.ts @description Owner and virtual document isolation checks. @module language */
import assert from "node:assert/strict";
import test from "node:test";
import { authorizeUpgrade, documentUri, validateMessage, hasManagedCredentials } from "./policy.ts";

void test("development owner requires loopback and exact browser origin", () => {
  const url = new URL("http://localhost/lsp?user=alice");
  assert.equal(authorizeUpgrade("127.0.0.1", "http://localhost:5173", url), "alice");
  assert.equal(authorizeUpgrade("203.0.113.1", "http://localhost:5173", url), null);
  assert.equal(authorizeUpgrade("127.0.0.1", "https://untrusted.example", url), null);
  assert.equal(authorizeUpgrade("127.0.0.1", undefined, url), null);
  for (const user of ["charlie", "dana"])
    assert.equal(
      authorizeUpgrade(
        "127.0.0.1",
        "http://localhost:5173",
        new URL(`http://localhost/lsp?user=${user}`),
      ),
      user,
    );
  assert.equal(
    authorizeUpgrade(
      "127.0.0.1",
      "http://localhost:5173",
      new URL("http://localhost/lsp?user=unknown"),
    ),
    null,
  );
});

void test("foreign documents and configuration mutations are rejected", () => {
  assert.throws(() =>
    validateMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "textDocument/hover",
        params: { textDocument: { uri: "file:///other-owner/main.py" } },
      }),
    ),
  );
  assert.throws(() =>
    validateMessage(
      JSON.stringify({ jsonrpc: "2.0", method: "workspace/didChangeConfiguration", params: {} }),
    ),
  );
  assert.equal(
    validateMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "textDocument/hover",
        params: { textDocument: { uri: documentUri } },
      }),
    ).method,
    "textDocument/hover",
  );
});

void test("present managed credentials cannot silently select fixture ownership", () => {
  for (const value of ["", "Bearer ", "Bearer forged", "Basic forged"])
    assert.equal(hasManagedCredentials(value, undefined), true);
  for (const value of ["bearer.", "quorem, bearer.", "quorem,bearer.forged"])
    assert.equal(hasManagedCredentials(undefined, value), true);
  assert.equal(hasManagedCredentials(undefined, undefined), false);
  assert.equal(hasManagedCredentials(undefined, "quorem"), false);
});
