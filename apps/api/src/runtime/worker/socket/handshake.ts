/** @file handshake.ts @description Shared browser WebSocket upgrade validation. @module runtime */
export const hibernatingProtocol = "quorem-hibernate";

export function socketHandshake(request: Request, origins: readonly string[]): number | undefined {
  if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket")
    return 426;
  const origin = request.headers.get("origin");
  if (!origin || !origins.includes(origin)) return 403;
  const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((value) => value.trim());
  if (protocols.filter((value) => value === hibernatingProtocol).length !== 1) return 400;
  if (
    request.headers.has("authorization") ||
    protocols.some((value) => value.startsWith("bearer."))
  )
    return 401;
  return undefined;
}
