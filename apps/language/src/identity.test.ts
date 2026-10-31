import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { managedOwner, IdentityUnavailable } from "./identity.ts";

void test("managed session uses API authority and distinguishes denial from outage", async () => {
  let status = 200,
    body: unknown = {
      mode: "managed",
      kind: "account",
      user: { id: "owner", emailVerified: true },
      capabilities: { hostedIntelligence: true },
    };
  let authorization = "";
  const server = createServer((request, response) => {
    authorization = request.headers.authorization ?? "";
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  process.env.AUTH_ORIGIN = "https://web.test";
  process.env.API_IDENTITY_URL = `http://127.0.0.1:${port}`;
  try {
    assert.equal(await managedOwner("quorem, bearer.token", "https://web.test", "/lsp"), "owner");
    assert.equal(authorization, "Bearer token");
    assert.equal(await managedOwner("bearer.one,bearer.two", "https://web.test", "/lsp"), null);
    assert.equal(await managedOwner("bearer.token", "https://bad.test", "/lsp"), null);
    body = {
      mode: "managed",
      kind: "guest",
      user: { id: "owner", emailVerified: true },
      capabilities: { hostedIntelligence: true },
    };
    assert.equal(await managedOwner("bearer.token", "https://web.test", "/lsp"), null);
    status = 401;
    assert.equal(await managedOwner("bearer.token", "https://web.test", "/lsp"), null);
    status = 503;
    await assert.rejects(
      managedOwner("bearer.token", "https://web.test", "/lsp"),
      IdentityUnavailable,
    );
    status = 200;
    body = { data: "x".repeat(65537) };
    await assert.rejects(
      managedOwner("bearer.token", "https://web.test", "/lsp"),
      IdentityUnavailable,
    );
  } finally {
    delete process.env.AUTH_ORIGIN;
    delete process.env.API_IDENTITY_URL;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

void test("managed authority timeout is unavailable", async () => {
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  process.env.AUTH_ORIGIN = "https://web.test";
  process.env.API_IDENTITY_URL = `http://127.0.0.1:${port}`;
  try {
    await assert.rejects(
      managedOwner("bearer.token", "https://web.test", "/lsp"),
      IdentityUnavailable,
    );
  } finally {
    delete process.env.AUTH_ORIGIN;
    delete process.env.API_IDENTITY_URL;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
