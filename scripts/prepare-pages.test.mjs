/** @file prepare-pages.test.mjs @description Verify public routes and the HTTP 404 app entry in an isolated artifact. @module deployment */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

await test("legal routes resolve to the app and unknown URLs retain a real 404 entry", () => {
  const workspace = mkdtempSync(join(tmpdir(), "quorem-pages-"));
  try {
    const artifact = join(workspace, "apps/web/dist");
    mkdirSync(artifact, { recursive: true });
    const entry =
      '<!doctype html><title>Quorem · Practice</title><div id="root"></div><script type="module" src="/assets/app.js"></script>';
    writeFileSync(join(artifact, "app.html"), entry);
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./prepare-pages.mjs", import.meta.url))],
      { cwd: workspace },
    );
    const redirects = readFileSync(join(artifact, "_redirects"), "utf8");
    for (const route of ["privacy", "terms", "practice", "interview"]) {
      assert.ok(redirects.split("\n").includes(`/${route} /app 200`));
    }
    assert.ok(!redirects.split("\n").some((line) => line.startsWith("/* ")));
    const fallback = readFileSync(join(artifact, "404.html"), "utf8");
    assert.ok(fallback.includes("Page not found · Quorem"));
    assert.ok(fallback.includes('src="/assets/app.js"'));
    assert.equal(readFileSync(join(artifact, "app.html"), "utf8"), entry);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
