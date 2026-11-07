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
    const routes = {
      "/privacy": "privacy",
      "/terms": "terms",
      "/practice": "practice",
      "/practice/:slug": "practice-slug",
      "/party": "party",
      "/match/:id": "match-id",
      "/match/:id/review": "match-id-review",
      "/invite/:token": "invite-token",
      "/login": "login",
      "/admin": "admin",
      "/questions": "questions",
      "/interviews": "interviews",
      "/interview/:id": "interview-id",
      "/interview-invite/:token": "interview-invite-token",
    };
    for (const [path, file] of Object.entries(routes)) {
      assert.ok(redirects.includes(`${path} /route-${file} 200`));
      assert.ok(redirects.includes(`${path}/ /route-${file} 200`));
      const html = read(`route-${file}.html`);
      assert.equal((html.match(/<title>/g) ?? []).length, 1);
      assert.ok(html.includes('src="/assets/app.js"'));
      assert.ok(html.includes('content="https://example.test/social-preview.jpg"'));
      assert.ok(html.includes('name="description"'));
      assert.ok(html.includes('property="og:description"'));
      assert.ok(html.includes('name="twitter:description"'));
      assert.equal(html.includes('content="noindex, follow"'), !pageSeo(path).indexable);
      assert.equal(html.includes('rel="canonical"'), pageSeo(path).indexable);
      assert.equal(html.includes('property="og:url"'), pageSeo(path).indexable);
    }
    assert.ok(!redirects.some((line) => line.includes("*")));
    assert.ok(read("route-match-id-review.html").includes("<title>Match Review - Quorem</title>"));
    assert.ok(
      read("route-practice.html").includes('rel="canonical" href="https://example.test/practice"'),
    );
    assert.ok(read("404.html").includes('name="robots" content="noindex, follow"'));
    assert.ok(read("404.html").includes("<title>Page not found - Quorem</title>"));
    assert.equal(read("app.html"), entry);
    assert.ok(read("robots.txt").includes("Sitemap: https://example.test/sitemap.xml"));
    const sitemap = read("sitemap.xml");
    assert.ok(sitemap.includes("https://example.test/practice</loc>"));
    assert.ok(!/invite|interview|login|admin|party|match|questions/.test(sitemap));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

await test("invitation metadata never exposes tokens and metadata text is escaped", () => {
  const html = seoMarkup("/invite/secret-token?ref=private");
  assert.ok(!html.includes("secret-token"));
  assert.ok(!html.includes("ref=private"));
  assert.ok(seoMarkup("/practice/workspace").includes("Quorem&#39;s coding editor"));
  assert.equal(pageSeo("/practice/").indexable, true);
  assert.equal(pageSeo("/practice/private-question").indexable, false);
  assert.equal(pageSeo("/match/private-id/review").title, "Match Review - Quorem");
  assert.equal(pageSeo("/match/private-id/missing").title, "Page not found - Quorem");
  assert.equal(pageSeo("/privacy/missing").title, "Page not found - Quorem");
});
