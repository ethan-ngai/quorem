/** @file prepare-pages.mjs @description Pages routing and cache policy for the combined static frontend. @module deployment */
import {
  appPaths,
  publicPaths,
  escapeHtml,
  routeSeoFile,
  seoMarkup,
} from "../packages/ui/src/seo.ts";
import { readFileSync, writeFileSync } from "node:fs";

const directory = "apps/web/dist";
const origin = process.env.QUOREM_SITE_URL ?? "https://quorem.app";
const entry = readFileSync(`${directory}/app.html`, "utf8");
const render = (path) =>
  entry.replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, seoMarkup(path, origin));
if (!entry.includes("<!-- seo:start -->")) throw new Error("App entry is missing SEO metadata");
const routes = [...appPaths]
  .sort((a, b) => Number(a.includes(":")) - Number(b.includes(":")))
  .flatMap((path) => {
    const name = routeSeoFile(path);
    writeFileSync(`${directory}/${name}.html`, render(path));
    return [`${path} /${name} 200`, `${path}/ /${name} 200`];
  });
writeFileSync(`${directory}/_redirects`, routes.join("\n") + "\n");
writeFileSync(
  `${directory}/robots.txt`,
  `User-agent: *\nAllow: /\n\nSitemap: ${new URL("/sitemap.xml", origin).href}\n`,
);
writeFileSync(
  `${directory}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPaths.map((path) => `<url><loc>${escapeHtml(new URL(path, origin).href)}</loc></url>`).join("")}</urlset>\n`,
);
writeFileSync(
  `${directory}/_headers`,
  `/*
  X-Quorem-Frontend: Pages
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/_marketing/*
  Cache-Control: public, max-age=31536000, immutable
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
// Keep Pages' HTTP 404 status while booting the app's shared recovery screen.
writeFileSync(`${directory}/404.html`, render("/missing"));
