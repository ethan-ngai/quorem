/** @file vitest.socket.config.ts @description Native PostgreSQL socket lifecycle tests. @module api */
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
export default defineConfig({ plugins: [cloudflareTest({ miniflare: { compatibilityDate: '2026-10-23', compatibilityFlags: ['nodejs_compat'], bindings: { SOCKET_TEST_URL: process.env.QUOREM_SOCKET_TEST_DATABASE_URL ?? '' } } })], test: { include: ['src/test/socket-lifecycle.test.ts'] } });
