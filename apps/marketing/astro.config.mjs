import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  integrations: [react()],
  vite: { resolve: { dedupe: ["react", "react-dom"] } },
  site: process.env.QUOREM_SITE_URL,
  output: "static",
  devToolbar: { enabled: false },
  publicDir: "../web/public",
  build: { assets: "_marketing" },
  server: { host: "127.0.0.1", port: 4321 },
});
