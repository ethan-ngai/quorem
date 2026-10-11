import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  devToolbar: { enabled: false },
  publicDir: "../web/public",
  build: { assets: "_marketing" },
  server: { host: "127.0.0.1", port: 4321 },
});
