/** @file runtime.test.ts @description Verify Vitest runs inside workerd. @module migration-runtime */
import { expect, test } from 'vitest';
test('runs in workerd', () => {
  expect(navigator.userAgent).toContain('Cloudflare-Workers');
  expect(typeof WebSocketPair).toBe('function');
});
