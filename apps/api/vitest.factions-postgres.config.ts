import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/adapters/postgres/factions/integration.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
