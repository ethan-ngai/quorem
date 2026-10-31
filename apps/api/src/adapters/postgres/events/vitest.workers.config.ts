import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/adapters/postgres/events/worker-fixture.ts",
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: { DISPATCH_DATABASE_URL: process.env.QUOREM_DISPATCH_TEST_DATABASE_URL ?? "" },
      },
    }),
  ],
  test: { include: ["src/adapters/postgres/events/worker.test.ts"] },
});
