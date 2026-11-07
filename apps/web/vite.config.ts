/** @file vite.config.ts @description Editor development and build configuration. @module web */
import { pageSeo, routeSeoFile, seoMarkup } from "../../packages/ui/src/seo.ts";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite-plus";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { marketingDevBase, marketingDevHtml } from "../../scripts/marketing-dev.mjs";

/** Serve the assembled production artifact; development proxies live Astro/HMR. */
function marketingPages(): Plugin {
  const web = resolve(fileURLToPath(new URL("./dist/", import.meta.url)));
  const serve = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const page = pageSeo(path);
    if (!page.route) return next();
    const file = resolve(
      web,
      page.route === "/" ? "index.html" : `${routeSeoFile(page.route)}.html`,
    );
    if (!existsSync(file)) return next();
    res.setHeader("Content-Type", "text/html");
    createReadStream(file).pipe(res);
  };
  return {
    name: "quorem-marketing",
    transformIndexHtml(html, context) {
      return html.replace(
        "<!-- site-seo -->",
        seoMarkup(
          context.server
            ? new URL(context.originalUrl ?? context.path, "http://localhost").pathname
            : "/404",
          process.env.QUOREM_SITE_URL,
        ),
      );
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (new URL(req.url ?? "/", "http://localhost").pathname !== "/") return next();
        try {
          const response = await fetch(
            `${marketingOrigin}${marketingEntry}${new URL(req.url ?? "/", "http://localhost").search}`,
            { signal: AbortSignal.timeout(5000) },
          );
          res.statusCode = response.status;
          res.setHeader("Content-Type", response.headers.get("Content-Type") ?? "text/html");
          res.end(marketingDevHtml(await response.text(), marketingEntry));
        } catch {
          res.statusCode = 503;
          res.end("Marketing dev server unavailable. Start make dev or the Astro dev server.");
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
  };
}

const apiOrigin = process.env.QUOREM_API_DEV_ORIGIN ?? "http://127.0.0.1:8080";
const marketingOrigin = process.env.QUOREM_MARKETING_DEV_ORIGIN ?? "http://127.0.0.1:4321";
const marketingEntry = marketingDevBase(process.env.QUOREM_MARKETING_BASE);

export default defineConfig({
  cacheDir: process.env.QUOREM_VITE_CACHE_DIR,
  plugins: [marketingPages(), react()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      [marketingEntry.replace(/\/$/, "")]: { target: marketingOrigin, ws: true },
      "/v1": { target: apiOrigin, ws: true },
      "/api/auth": process.env.QUOREM_AUTH_DEV_ORIGIN ?? apiOrigin,
    },
  },
});
