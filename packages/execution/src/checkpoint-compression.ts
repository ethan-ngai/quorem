/** @file checkpoint-compression.ts @description Bounded gzip checkpoint frame storage. @module execution */
import { parseLosslessJson } from "@quorem/questions";
const maxFrame = (2 << 20) + 4096;
function validFrame(data: Uint8Array): void {
  if (data.byteLength > maxFrame) throw new Error("invalid checkpoint frame");
  try {
    parseLosslessJson(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new Error("invalid checkpoint frame");
  }
}
async function transform(
  data: Uint8Array,
  stream: TransformStream<BufferSource, Uint8Array<ArrayBuffer>>,
  max: number,
): Promise<Uint8Array> {
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(Uint8Array.from(data));
      controller.close();
    },
  });
  const reader = input.pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > max) throw new Error("invalid checkpoint frame");
      chunks.push(next.value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error("invalid checkpoint frame");
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
/** Compress one bounded JSON frame, keeping the database payload opaque. */
export async function compressCheckpointFrame(frame: Uint8Array): Promise<Uint8Array> {
  validFrame(frame);
  return transform(frame, new CompressionStream("gzip"), 4 << 20);
}
/** Decompress one bounded envelope; the inner frame retains the 2 MiB limit. */
export async function decompressCheckpointFrame(frame: Uint8Array): Promise<Uint8Array> {
  if (frame.byteLength > 4 << 20) throw new Error("invalid checkpoint frame");
  const decoded = await transform(frame, new DecompressionStream("gzip"), maxFrame);
  validFrame(decoded);
  return decoded;
}
