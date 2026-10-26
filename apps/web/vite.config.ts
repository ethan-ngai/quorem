/** @file vite.config.ts @description Editor development and build configuration. @module web */
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite-plus";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";

/** Serve the assembled production artifact; development proxies live Astro/HMR. */
function marketingPages(): Plugin {
  const web = resolve(fileURLToPath(new URL("./dist/", import.meta.url)));
  const serve = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const app =
      /^\/(privacy|terms|practice|match|invite|login|admin|interviews|interview|interview-invite)(\/|$)/.test(
        path,
      );
    if (!app && path !== "/" && !path.startsWith("/_marketing/")) return next();
    const base = web;
    const file = resolve(base, app ? "app.html" : path === "/" ? "index.html" : `.${path}`);
    if (!file.startsWith(`${base}/`) || !existsSync(file)) return next();
    const types: Record<string, string> = {
      ".css": "text/css",
      ".js": "text/javascript",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".html": "text/html",
    };
    res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(res);
  };
  return {
    name: "quorem-marketing",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (new URL(req.url ?? "/", "http://localhost").pathname !== "/") return next();
        try {
          const response = await fetch(
            `${marketingOrigin}${marketingEntry}${new URL(req.url ?? "/", "http://localhost").search}`,
          );
          res.statusCode = response.status;
          res.setHeader("Content-Type", response.headers.get("Content-Type") ?? "text/html");
          // Astro 6 emits root-relative island URLs even with a namespaced Vite base.
          const html = (await response.text()).replace(
            /(["'])\/(src\/|@id\/|@fs\/|node_modules\/)/g,
            "$1/_marketing/$2",
          );
          res.end(html);
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

const marketingOrigin = process.env.QUOREM_MARKETING_DEV_ORIGIN ?? "http://127.0.0.1:4321";
const marketingEntry = `${process.env.QUOREM_MARKETING_BASE ?? "/"}/`.replace(/\/+/g, "/");

export default defineConfig({
  plugins: [marketingPages(), react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/_marketing": { target: marketingOrigin, ws: true },
      "/v1": { target: process.env.QUOREM_API_DEV_ORIGIN ?? "http://127.0.0.1:8080", ws: true },
      "/api/auth": process.env.QUOREM_AUTH_DEV_ORIGIN ?? "http://127.0.0.1:8082",
    },
  },
});
