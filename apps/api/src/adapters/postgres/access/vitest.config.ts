import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/adapters/postgres/access/grants.integration.test.ts"] },
});
