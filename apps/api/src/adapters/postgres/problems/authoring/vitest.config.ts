import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "src/adapters/postgres/problems/authoring/repository.test.ts",
      "src/modules/problems/authoring/*.test.ts",
    ],
  },
});
