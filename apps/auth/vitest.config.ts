import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration suites share one disposable auth schema and run DDL migrations.
    fileParallelism: false,
    setupFiles: ["./src/vitest-setup.ts"],
    env: { AUTH_MAIL_INTENT_KEY: "04".repeat(32) },
    exclude: [...configDefaults.exclude, "src/mail-intents.test.ts"],
  },
});
