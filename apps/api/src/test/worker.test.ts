/** @file worker.test.ts @description Workerd HTTP contract. @module api */
/// <reference types="@cloudflare/vitest-plugin/types" />
import { SELF } from 'cloudflare:test';
import { expect, test } from 'vitest';
import worker from '../runtime/worker.ts';
import { contract } from './contract.ts';
contract((path, init) => SELF.fetch(`http://localhost${path}`, init));

test('worker shell composes configured origins', async () => {
  const response = await worker.fetch(new Request('https://api.test/health', { headers: { origin: 'https://quorem.test' } }), { ALLOWED_ORIGINS: 'https://quorem.test' });
  expect(response.status).toBe(200);
  expect(response.headers.get('access-control-allow-origin')).toBe('https://quorem.test');
});
