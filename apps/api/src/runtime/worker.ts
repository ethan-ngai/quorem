/** @file worker.ts @description Worker HTTP shell. @module api */
import { createApp } from '../app.ts';

interface Env { ALLOWED_ORIGINS?: string }
export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
    return createApp({ allowedOrigins, requestId: () => crypto.randomUUID() }).fetch(request);
  },
};
