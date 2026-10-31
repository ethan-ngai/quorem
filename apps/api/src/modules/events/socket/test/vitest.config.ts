import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/modules/events/socket/*.test.ts"] } });
