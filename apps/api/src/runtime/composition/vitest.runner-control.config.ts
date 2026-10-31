import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "../../deploy/hono/services/runner-control-workerd-fixture.js",
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: { RELEASE_CONTROL: "RunnerReleaseControl" },
      },
    }),
  ],
  test: { include: ["src/runtime/composition/runner-control.workerd.test.ts"] },
});
