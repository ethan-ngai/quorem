import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/adapters/identity/*.test.ts", "src/adapters/postgres/**/*.test.ts"] },
});
