/** @file policy.test.ts @description Owner and virtual document isolation checks. @module language */
import assert from "node:assert/strict";
import test from "node:test";
import { authorizeUpgrade, documentUri, validateMessage } from "./policy.ts";

void test("development owner requires loopback and exact browser origin", () => {
  const url = new URL("http://localhost/lsp?user=alice");
  assert.equal(authorizeUpgrade("127.0.0.1", "http://localhost:5173", url), "alice");
  assert.equal(authorizeUpgrade("203.0.113.1", "http://localhost:5173", url), null);
  assert.equal(authorizeUpgrade("127.0.0.1", "https://untrusted.example", url), null);
  assert.equal(authorizeUpgrade("127.0.0.1", undefined, url), null);
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
