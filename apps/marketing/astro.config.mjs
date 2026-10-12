import react from "@astrojs/react";
import { defineConfig } from "astro/config";

const base = `${process.env.QUOREM_MARKETING_BASE ?? "/"}/`.replace(/\/+/g, "/");

export default defineConfig({
  integrations: [react()],
  vite: {
    base: base === "/" ? undefined : base,
    ssr: { noExternal: ["lucide-react", /^@radix-ui\//] },
    resolve: { dedupe: ["react", "react-dom"] },
    server: {
      strictPort: true,
      ws:
        base === "/"
          ? undefined
          : {
              path: "hmr",
              clientPort: Number(new URL(process.env.WEB_ORIGIN ?? "http://localhost:5173").port),
            },
    },
  },
  site: process.env.QUOREM_SITE_URL,
  output: "static",
  devToolbar: { enabled: false },
  publicDir: "../web/public",
  build: { assets: "_marketing" },
  server: { host: "127.0.0.1", port: 4321 },
});
