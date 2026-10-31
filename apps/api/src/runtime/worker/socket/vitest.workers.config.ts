import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/runtime/worker/socket/worker-fixture.test.ts",
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: { SOCKET: "BrowserSocketFixture" },
        bindings: { DATABASE: process.env.QUOREM_DO_SOCKET_TEST_URL ?? "" },
      },
    }),
  ],
  test: { testTimeout: 25000, include: ["src/runtime/worker/socket/worker.test.ts"] },
});
