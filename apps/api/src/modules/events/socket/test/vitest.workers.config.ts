import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: { compatibilityDate: "2026-10-23", compatibilityFlags: ["nodejs_compat"] },
    }),
  ],
  test: { include: ["src/modules/events/socket/session.test.ts"] },
});
