import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "../../deploy/hono/services/case-control-fixture.js",
      miniflare: {
        compatibilityDate: "2026-10-23",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: { CONTROL: "CaseControl", CASES: "CaseNamespace" },
      },
    }),
  ],
  test: { include: ["src/runtime/composition/case-control.workerd.test.ts"] },
});
