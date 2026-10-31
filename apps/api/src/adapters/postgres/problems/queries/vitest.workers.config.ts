import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/adapters/postgres/problems/queries/worker-fixture.ts",
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: { CATALOG_TEST_DATABASE_URL: process.env.QUOREM_CATALOG_TEST_DATABASE_URL ?? "" },
      },
    }),
  ],
  test: {
    include: [
      "src/modules/problems/routes.test.ts",
      "src/adapters/postgres/problems/queries/worker.test.ts",
    ],
  },
});
