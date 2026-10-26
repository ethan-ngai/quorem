/** @file marketing-dev.test.mjs @description Verify Astro and workspace dev namespaces agree without changing production asset paths. @module tooling */
import assert from "node:assert/strict";
import test from "node:test";
import astro from "../apps/marketing/astro.config.mjs";
import web from "../apps/web/vite.config.ts";
import { marketingDevBase, marketingDevHtml } from "./marketing-dev.mjs";

const integration = astro.integrations.find((item) => item.name === "quorem-marketing-dev");

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
