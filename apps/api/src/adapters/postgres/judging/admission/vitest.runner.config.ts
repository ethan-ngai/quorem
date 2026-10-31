import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    fileParallelism: false,
    ...(process.env.QUOREM_REPORT_JSON_STDOUT === "true"
      ? { reporters: [["json", { stdout: true }]] }
      : {}),
    include: [
      "src/adapters/postgres/judging/admission/runner.integration.test.ts",
      "src/adapters/postgres/judging/admission/runner-inputs.test.ts",
    ],
  },
});
