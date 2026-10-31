import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "src/adapters/postgres/interviews/question/indexed.test.ts",
      "src/adapters/postgres/interviews/question/legacy-ranges.test.ts",
      "src/adapters/postgres/interviews/question/backfill-inputs.test.ts",
      "src/adapters/postgres/interviews/question/operator-inputs.test.ts",
      "src/adapters/postgres/interviews/question/large-backfill.test.ts",
    ],
  },
});
