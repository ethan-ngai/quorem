import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/adapters/identity/*.test.ts", "src/adapters/postgres/identity/**/*.test.ts"],
    exclude: ["**/*.worker.test.ts", "**/worker.test.ts"],
  },
});
