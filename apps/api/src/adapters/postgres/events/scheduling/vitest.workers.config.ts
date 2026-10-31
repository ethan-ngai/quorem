import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/adapters/postgres/events/scheduling/worker-fixture.test.ts",
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          SCHEDULING_DATABASE_URL: process.env.QUOREM_SCHEDULING_TEST_DATABASE_URL ?? "",
        },
        durableObjects: { DEADLINES: "DeadlineCoordinator" },
      },
    }),
  ],
  test: { include: ["src/adapters/postgres/events/scheduling/worker.test.ts"] },
});
