import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/adapters/postgres/problems/authoring/worker-fixture.ts",
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          AUTHORING_TEST_DATABASE_URL: process.env.QUOREM_AUTHORING_TEST_DATABASE_URL ?? "",
        },
      },
    }),
  ],
  test: {
    include: [
      "src/modules/problems/authoring/routes.test.ts",
      "src/adapters/postgres/problems/authoring/worker.test.ts",
    ],
  },
});
