import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      "src/modules/judging/admission/*.test.ts",
      "src/adapters/postgres/judging/admission/recovery.test.ts",
      "src/adapters/postgres/judging/admission/repository.test.ts",
      "src/adapters/postgres/judging/admission/results.integration.test.ts",
      "src/adapters/postgres/judging/admission/match.test.ts",
      "src/adapters/postgres/judging/admission/cases.test.ts",
      "src/adapters/postgres/judging/admission/core.test.ts",
      "src/adapters/postgres/problems/storage.test.ts",
      "src/adapters/postgres/access/repository.test.ts",
    ],
  },
});
