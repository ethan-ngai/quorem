/** @file vitest.config.ts @description Social HTTP and disposable PostgreSQL tests. @module social */
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "src/modules/social/routes.test.ts",
      "src/adapters/postgres/social/repository.test.ts",
    ],
  },
});
