import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "../../deploy/hono/services/worker.js",
      miniflare: { compatibilityDate: "2026-10-23", compatibilityFlags: ["nodejs_compat"] },
    }),
  ],
  test: { include: ["src/runtime/composition/services.workerd.test.ts"] },
});
