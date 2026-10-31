import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: { SOCKET_MATCH_URL: process.env.QUOREM_SOCKET_MATCH_TEST_URL ?? "" },
      },
    }),
  ],
  test: { include: ["src/modules/events/socket/test/match.worker.ts"] },
});
