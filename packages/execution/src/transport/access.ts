/** @file access.ts @description Optional purpose-bound private ingress authentication. @module runner */
export type AccessCredentials = { id: string; secret: string };
/** Access credentials may only accompany requests to the configured HTTPS origin. */
export function accessFetch(
  origin: string,
  credentials: AccessCredentials | undefined,
  send: typeof fetch = fetch,
): typeof fetch | undefined {
  if (!credentials) return undefined;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.protocol !== "https:" || url.origin !== origin)
      throw new Error("Private ingress origin mismatch");
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (headers.has("CF-Access-Client-Id") || headers.has("CF-Access-Client-Secret"))
      throw new Error("Private ingress headers already set");
    headers.set("CF-Access-Client-Id", credentials.id);
    headers.set("CF-Access-Client-Secret", credentials.secret);
    return send(input, { ...init, headers });
  };
}
