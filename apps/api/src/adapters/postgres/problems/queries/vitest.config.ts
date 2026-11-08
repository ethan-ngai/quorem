import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globalSetup: ["./src/adapters/postgres/problems/queries/test-database.ts"],
    include: [
      "src/modules/problems/routes.test.ts",
      "src/modules/problems/recommendations/*.test.ts",
      "src/adapters/postgres/problems/queries/repository.test.ts",
      "src/adapters/postgres/problems/recommendations/repository.test.ts",
      "src/adapters/postgres/problems/queries/public-projection.test.ts",
    ],
  },
});
