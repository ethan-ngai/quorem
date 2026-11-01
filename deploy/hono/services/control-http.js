/** Bounded JSON for private deployment controls. */
export async function readControlJson(request, maxBytes = 2048) {
  if (!request.body || Number(request.headers.get("content-length")) > maxBytes)
    throw new Error("Invalid control body");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Control body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Never forward operator credentials into a private Durable Object. */
export async function controlRequest(request, target) {
  const headers = new Headers();
  for (const key of ["x-quorem-owner-scope", "x-quorem-owner-nonce"]) {
    const value = request.headers.get(key);
    if (value !== null) headers.set(key, value);
  }
  if (request.method === "GET") return new Request(target, { headers });
  headers.set("content-type", "application/json");
  return new Request(target, {
    method: request.method,
    headers,
    body: JSON.stringify(await readControlJson(request, 4096)),
  });
}
