/** @file app.ts @description Portable HTTP composition. @module api */
import { Hono } from 'hono';
import { ApplicationError } from './application/error.ts';

export interface Dependencies {
  allowedOrigins: readonly string[];
  requestId: () => string;
}

type Variables = { requestId: string };

export function createApp(dependencies: Dependencies): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();
  app.use('*', async (c, next) => {
    const id = dependencies.requestId();
    c.set('requestId', id);
    c.header('X-Request-ID', id);
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')?.replace(/\/$/, '');
    if (origin) {
      if (!dependencies.allowedOrigins.includes(origin)) {
        throw new ApplicationError('forbidden', 'Origin denied', 403);
      }
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, X-Dev-User, Authorization');
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });
  app.onError((error, c) => {
    const expected = error instanceof ApplicationError;
    const status = expected ? error.status : 503;
    if (status === 429) c.header('Retry-After', '6');
    return c.json({ error: {
      code: expected ? error.code : 'temporarily_unavailable',
      message: expected ? error.message : 'Service unavailable',
      requestId: c.get('requestId'),
    } }, { status });
  });
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.all('/health', (c) => {
    c.header('Allow', 'GET, HEAD');
    return c.json({ error: { code: 'method_not_allowed', message: 'Method not allowed', requestId: c.get('requestId') } }, 405);
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found', requestId: c.get('requestId') } }, 404));
  return app;
}
