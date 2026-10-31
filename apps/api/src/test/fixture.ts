/** @file fixture.ts @description Common HTTP test fixture. @module api */
import { createApp } from '../app.ts';
import { ApplicationError } from '../application/error.ts';
export function fixture() {
  const app = createApp({ allowedOrigins: ['https://quorem.test'], requestId: () => crypto.randomUUID() });
  app.get('/expected', () => { throw new ApplicationError('rate_limited', 'Try again', 429); });
  app.get('/unexpected', () => { throw new Error('private provider detail'); });
  return app;
}
