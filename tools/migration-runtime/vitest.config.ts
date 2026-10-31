/** @file vitest.config.ts @description Workerd Vitest smoke configuration. @module migration-runtime */
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vite-plus';
export default defineConfig({ plugins: [cloudflareTest({ miniflare: { compatibilityDate: '2026-03-17', compatibilityFlags: ['nodejs_compat'] } })], test: { include: ['runtime.test.ts'] } });
