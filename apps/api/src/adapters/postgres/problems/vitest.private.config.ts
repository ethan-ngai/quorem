import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/adapters/postgres/problems/private-content.test.ts"] },
});
