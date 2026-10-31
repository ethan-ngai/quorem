/** @file vitest.config.ts @description Node foundation tests. @module api */
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/test/node.test.ts'] } });
