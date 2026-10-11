/** @file vite.config.ts @description Editor development and build configuration. @module web */
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite-plus";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";

/** Keep Astro's static homepage and the workspace on one origin. */
function marketingPages(): Plugin {
  const marketing = resolve(fileURLToPath(new URL("../marketing/dist/", import.meta.url)));
  const web = resolve(fileURLToPath(new URL("./dist/", import.meta.url)));
  const serve =
    (preview: boolean) => (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      const app = preview && /^\/(practice|match|invite)(\/|$)/.test(path);
      if (!app && path !== "/" && !path.startsWith("/_marketing/")) return next();
      const base = preview ? web : marketing;
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
      server.middlewares.use(serve(false));
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve(true));
    },
  };
}

export default defineConfig({
  plugins: [marketingPages(), react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/v1": "http://127.0.0.1:8080",
    },
  },
});
