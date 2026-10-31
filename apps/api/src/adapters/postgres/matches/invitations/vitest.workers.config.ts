import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/adapters/postgres/matches/invitations/worker-fixture.ts",
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          MATCH_LIFECYCLE_URL: process.env.QUOREM_MATCH_LIFECYCLE_TEST_DATABASE_URL ?? "",
        },
        durableObjects: { DEADLINES: "DeadlineCoordinator" },
      },
    }),
  ],
  test: { include: ["src/adapters/postgres/matches/invitations/worker.ts"] },
});
