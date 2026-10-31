/** @file vitest.workers.config.ts @description Workerd workspace integration. @module workspace */
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
export default defineConfig({ plugins: [cloudflareTest({ miniflare: { compatibilityDate: '2026-10-23', compatibilityFlags: ['nodejs_compat'], bindings: { WORKSPACE_TEST_URL: process.env.QUOREM_WORKSPACE_TEST_DATABASE_URL ?? '' } } })], test: { include: ['src/adapters/postgres/workspace/worker.ts'] } });
