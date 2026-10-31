/** @file contract.ts @description Shared HTTP contract tests. @module api */
import { expect, test } from 'vitest';
export function contract(fetchRequest: (path: string, init?: RequestInit) => Promise<Response>): void {
  test('health, correlation and no-store', async () => {
    const response = await fetchRequest('/health', { headers: { 'X-Request-ID': 'untrusted' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).not.toBe('untrusted');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });
  test('origin and preflight', async () => {
    const denied = await fetchRequest('/health', { headers: { origin: 'https://evil.test' } });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toMatchObject({ code: 'forbidden', requestId: denied.headers.get('x-request-id') });
    const allowed = await fetchRequest('/health', { method: 'OPTIONS', headers: { origin: 'https://quorem.test' } });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://quorem.test');
    expect(allowed.headers.get('vary')).toBe('Origin');
    expect(allowed.headers.get('cache-control')).toBe('no-store');
  });
  test('expected and redacted failures', async () => {
    const expected = await fetchRequest('/expected');
    expect(expected.status).toBe(429);
    expect(expected.headers.get('retry-after')).toBe('6');
    expect((await expected.json()).error).toMatchObject({ code: 'rate_limited', message: 'Try again', requestId: expected.headers.get('x-request-id') });
    const unexpected = await fetchRequest('/unexpected');
    expect(unexpected.status).toBe(503);
    expect((await unexpected.json()).error).toEqual({ code: 'temporarily_unavailable', message: 'Service unavailable', requestId: unexpected.headers.get('x-request-id') });
    const method = await fetchRequest('/health', { method: 'POST' });
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET, HEAD');
    const missing = await fetchRequest('/missing');
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.requestId).toBe(missing.headers.get('x-request-id'));
  });
}
