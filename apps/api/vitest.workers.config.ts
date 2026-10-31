/** @file vitest.workers.config.ts @description Workerd foundation tests. @module api */
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
export default defineConfig({ plugins: [cloudflareTest({ main: './src/test/worker-fixture.ts', miniflare: { compatibilityDate: '2026-10-23', compatibilityFlags: ['nodejs_compat'] } })], test: { include: ['src/test/worker.test.ts'] } });
