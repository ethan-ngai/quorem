/** @file vitest.workers.config.ts @description Guest workerd conformance. @module identity */
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
export default defineConfig({ plugins: [cloudflareTest({ miniflare: { compatibilityDate: '2026-10-23', compatibilityFlags: ['nodejs_compat'], bindings: { GUEST_TEST_URL: process.env.QUOREM_GUEST_TEST_DATABASE_URL ?? '' } } })], test: { include: ['src/modules/identity/guest/guest.test.ts', 'src/adapters/postgres/identity/guest.worker.ts'] } });
