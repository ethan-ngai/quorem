/** Translate the public hosted sign-in route to the configured upstream adapter. */
export async function hostedSignIn(
  request: Request,
  method: string,
  handler: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (method !== "cognito") return new Response(null, { status: 404 });
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 8192) return new Response(null, { status: 413 });
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const body = new TextDecoder().decode(bytes);
  let input: { callbackURL?: unknown; errorCallbackURL?: unknown };
  try {
    input = JSON.parse(body);
    if (!input || typeof input !== "object") throw new Error("invalid body");
  } catch {
    return new Response(null, { status: 400 });
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const url = new URL(request.url);
  url.pathname = "/api/auth/sign-in/social";
  return handler(
    new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: "cognito",
        callbackURL: input.callbackURL,
        errorCallbackURL: input.errorCallbackURL,
      }),
    }),
  );
}
