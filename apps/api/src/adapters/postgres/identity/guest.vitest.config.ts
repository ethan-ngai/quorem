/** @file vitest.config.ts @description Guest Node conformance. @module identity */
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/modules/identity/guest/guest.test.ts'] } });
