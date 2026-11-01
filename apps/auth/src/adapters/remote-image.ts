import { ImageExecutionUncertain, type ImageProcessor } from "../image-processing.ts";

export function remoteImageProcessor(
  endpoint: string,
  token: string,
  fetcher = fetch,
  allowLocalHttp = false,
): ImageProcessor {
  const url = new URL(endpoint);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && allowLocalHttp)) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname !== "/" ||
    token.length < 32 ||
    /\s/.test(token)
  )
    throw new Error("Invalid image service configuration");
  return {
    async process(bytes, expected) {
      let response: Response;
      try {
        response = await fetcher(url, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(12000),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/octet-stream",
            "x-image-format": expected,
          },
          body: new Uint8Array(bytes),
        });
      } catch {
        throw new ImageExecutionUncertain("Image executor unavailable");
      }
      if (response.headers.get("x-image-execution") !== "terminated") {
        await response.body?.cancel().catch(() => {});
        throw new ImageExecutionUncertain("Image executor outcome unknown");
      }
      if (response.status === 415) {
        await response.body?.cancel();
        return { kind: "unsupported" };
      }
      if (response.status === 422) {
        await response.body?.cancel();
        return { kind: "invalid" };
      }
      if (!response.ok || Number(response.headers.get("content-length")) > 5 * 1024 * 1024) {
        await response.body?.cancel();
        throw new Error("Image executor failed");
      }
      if (!response.body) throw new Error("Image executor returned no output");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 5 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("Image executor output too large");
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const output = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      return { kind: "processed", bytes: output };
    },
  };
}
