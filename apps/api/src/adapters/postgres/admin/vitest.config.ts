/** @file vitest.config.ts @description Administrator route and disposable PostgreSQL checks. @module admin */
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/modules/admin/*.test.ts", "src/adapters/postgres/admin/*.test.ts"] },
});
