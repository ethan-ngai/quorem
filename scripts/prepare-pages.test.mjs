/** @file prepare-pages.test.mjs @description Verify crawler-facing metadata and routing in an isolated artifact. @module deployment */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { seoMarkup, pageSeo } from "../packages/ui/src/seo.ts";

await test("static routes expose metadata before JavaScript; private routes and 404s stay noindex", () => {
  const workspace = mkdtempSync(join(tmpdir(), "quorem-pages-"));
  try {
    const artifact = join(workspace, "apps/web/dist");
    mkdirSync(artifact, { recursive: true });
    const entry = `<!doctype html><head>${seoMarkup("/app")}</head><div id="root"></div><script type="module" src="/assets/app.js"></script>`;
    writeFileSync(join(artifact, "app.html"), entry);
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./prepare-pages.mjs", import.meta.url))],
      { cwd: workspace, env: { ...process.env, QUOREM_SITE_URL: "https://example.test" } },
    );
    const read = (name) => readFileSync(join(artifact, name), "utf8");
    const redirects = read("_redirects").split("\n");
    for (const route of ["privacy", "terms", "practice", "interview", "invite", "login"]) {
      assert.ok(redirects.includes(`/${route} /route-${route} 200`));
      const html = read(`route-${route}.html`);
      assert.equal((html.match(/<title>/g) ?? []).length, 1);
      assert.ok(html.includes('src="/assets/app.js"'));
      assert.ok(html.includes('content="https://example.test/social-preview.jpg"'));
    }
    assert.ok(redirects.includes("/practice/* /route-workspace 200"));
    assert.ok(!redirects.some((line) => line.startsWith("/* ")));
    assert.ok(
      read("route-practice.html").includes('rel="canonical" href="https://example.test/practice"'),
    );
    for (const file of [
      "route-invite.html",
      "route-interview.html",
      "route-workspace.html",
      "404.html",
    ]) {
      assert.ok(read(file).includes('name="robots" content="noindex, follow"'));
      assert.ok(!read(file).includes('rel="canonical"'));
    }
    assert.ok(read("404.html").includes("Page not found"));
    assert.equal(read("app.html"), entry);
    assert.ok(read("robots.txt").includes("Sitemap: https://example.test/sitemap.xml"));
    const sitemap = read("sitemap.xml");
    assert.ok(sitemap.includes("https://example.test/practice</loc>"));
    assert.ok(!/invite|interview|login|admin/.test(sitemap));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

await test("invitation metadata never exposes tokens and title text is escaped", () => {
  const html = seoMarkup("/invite/secret-token?ref=private");
  assert.ok(!html.includes("secret-token"));
  assert.ok(!html.includes("ref=private"));
  assert.ok(seoMarkup("/").includes("Matches &amp; Interviews"));
  assert.equal(pageSeo("/practice/").indexable, true);
  assert.equal(pageSeo("/practice/private-question").indexable, false);
});
