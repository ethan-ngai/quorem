/** @file private-response.ts @description Apply request metadata to private streaming responses. @module runtime */
export function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-request-id", crypto.randomUUID());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
