/** @file json-body.ts @description Bounded UTF-8 JSON object decoding. @module application */
import { z } from "zod";
import { ApplicationError } from "./error.ts";
export async function jsonObjectBody(
  request: Request,
  limit: number,
  options: { emptyObject?: boolean } = {},
): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new ApplicationError("payload_too_large", "Request too large", 413);
  const reader = request.body?.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    size = 0;
  try {
    if (reader)
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new ApplicationError("payload_too_large", "Request too large", 413);
        }
        text += decoder.decode(part.value, { stream: true });
      }
    text += decoder.decode();
    const value: unknown = JSON.parse(text || (options.emptyObject ? "{}" : text));
    return z.record(z.string(), z.unknown()).parse(value);
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("invalid_input", "Invalid request body", 400);
  }
}
