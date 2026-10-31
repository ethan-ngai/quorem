/** @file health.ts @description Dependency-free health transport with shared HTTP defaults. @module runtime */
import { createApp } from "../../app.ts";
/** Health checks do not acquire provider connections. */
export function health(request: Request, origins: readonly string[]): Response | Promise<Response> {
  return createApp({ allowedOrigins: origins, requestId: () => crypto.randomUUID() }).fetch(
    request,
  );
}
