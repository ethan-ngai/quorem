import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "src/modules/identity/grant.test.ts",
      "src/modules/identity/routes.test.ts",
      "src/modules/events/socket/session.test.ts",
      "src/runtime/worker/socket/**/*.test.ts",
    ],
  },
});
