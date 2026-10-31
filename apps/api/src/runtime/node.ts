/** @file node.ts @description Node HTTP shell. @module api */
import { serve } from '@hono/node-server';
import { createApp } from '../app.ts';

const origins = (process.env.QUOREM_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
const app = createApp({ allowedOrigins: origins, requestId: () => crypto.randomUUID() });
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8080) });
