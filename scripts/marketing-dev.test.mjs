/** @file marketing-dev.test.mjs @description Verify Astro and workspace dev namespaces agree without changing production asset paths. @module tooling */
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite-plus";
import astro from "../apps/marketing/astro.config.mjs";
import web from "../apps/web/vite.config.ts";
import { marketingDevBase, marketingDevHtml } from "./marketing-dev.mjs";

const integration = astro.integrations.find((item) => item.name === "quorem-marketing-dev");

await test("Hono proxy shares auth origin and streams SSE before the backend closes", async () => {
  const backend = createServer((req, res) => {
    if (req.url === "/v1/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: ready\n\n");
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ path: req.url }));
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const previousApi = process.env.QUOREM_API_DEV_ORIGIN;
  const previousAuth = process.env.QUOREM_AUTH_DEV_ORIGIN;
  let vite;
  const stream = new AbortController();
  try {
    process.env.QUOREM_API_DEV_ORIGIN = `http://127.0.0.1:${backend.address().port}`;
    delete process.env.QUOREM_AUTH_DEV_ORIGIN;
    // A fresh config import exercises the default auth target with a custom API origin.
    const { default: config } = await import("../apps/web/vite.config.ts?proxy-test");
    vite = await createViteServer({
      ...config,
      configFile: false,
      root: fileURLToPath(new URL("../apps/web", import.meta.url)),
      server: { ...config.server, port: 0 },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const auth = await fetch(`${origin}/api/auth/get-session?refresh=1`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(auth.status, 200);
    assert.deepEqual(await auth.json(), { path: "/api/auth/get-session?refresh=1" });
    const response = await fetch(`${origin}/v1/events`, {
      signal: AbortSignal.any([stream.signal, AbortSignal.timeout(5000)]),
    });
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    const { value } = await response.body.getReader().read();
    assert.equal(new TextDecoder().decode(value), "data: ready\n\n");
  } finally {
    if (previousApi === undefined) delete process.env.QUOREM_API_DEV_ORIGIN;
    else process.env.QUOREM_API_DEV_ORIGIN = previousApi;
    if (previousAuth === undefined) delete process.env.QUOREM_AUTH_DEV_ORIGIN;
    else process.env.QUOREM_AUTH_DEV_ORIGIN = previousAuth;
    stream.abort();
    backend.closeAllConnections();
    await Promise.all([vite?.close(), new Promise((resolve) => backend.close(resolve))]);
  }
});

await test("HTML rewriting namespaces islands and normalizes Astro script URLs without changing app links", () => {
  const html =
    '<script src="/_marketing//@vite/client"></script><astro-island component-url="/src/Hero.tsx"></astro-island><a href="/practice">Practice</a>';
  const expected =
    '<script src="/_marketing/@vite/client"></script><astro-island component-url="/_marketing/src/Hero.tsx"></astro-island><a href="/practice">Practice</a>';
  assert.equal(marketingDevHtml(html, "/_marketing/"), expected);
  assert.equal(marketingDevHtml(expected, "/_marketing/"), expected);
});

await test("standalone Astro and workspace proxy share the default namespace", () => {
  let update;
  integration.hooks["astro:config:setup"]({
    command: "dev",
    updateConfig: (config) => {
      update = config;
    },
  });
  const base = update.vite.base;
  assert.equal(base, marketingDevBase(process.env.QUOREM_MARKETING_BASE));
  assert.ok(web.server.proxy[base.replace(/\/$/, "")]);
  assert.equal(update.vite.server.ws.path, "hmr");
});

await test("production build and preview keep their own asset configuration", () => {
  for (const command of ["build", "preview"]) {
    integration.hooks["astro:config:setup"]({
      command,
      updateConfig: () => assert.fail("Development namespace leaked into production"),
    });
  }
  assert.equal(astro.build.assets, "_marketing");
});

await test(
  "served marketing scripts and island modules return JavaScript",
  {
    skip: !process.env.QUOREM_MARKETING_SMOKE_ORIGIN,
  },
  async () => {
    const origin = process.env.QUOREM_MARKETING_SMOKE_ORIGIN;
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    const html = await page.text();
    const modules = new Set([
      ...[...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map(
        (match) => match[1],
      ),
      ...[...html.matchAll(/(?:component-url|renderer-url)="([^"]+)"/g)].map((match) => match[1]),
      `${marketingDevBase(process.env.QUOREM_MARKETING_BASE)}@id/astro:scripts/before-hydration.js`,
    ]);
    assert.ok(modules.size > 5, "Expected Astro scripts and React island entrypoints");
    for (const path of modules) {
      const response = await fetch(new URL(path.replaceAll("&amp;", "&"), origin));
      const body = await response.text();
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type") ?? "", /javascript/, path);
      assert.ok(body.length, path);
    }
  },
);
