/** @file json-body.ts @description Bounded UTF-8 JSON object decoding. @module application */
import { z } from "zod";
import { ApplicationError } from "./error.ts";

const jsonObject = z.record(z.string(), z.unknown());
const invalidBody = () => new ApplicationError("invalid_input", "Invalid request body", 400);

/** Read bounded UTF-8 without choosing a numeric representation. */
export async function boundedUtf8Body(request: Request, limit: number): Promise<string> {
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
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw invalidBody();
  } finally {
    reader?.releaseLock();
  }
}

export async function jsonObjectBody(
  request: Request,
  limit: number,
  options: { emptyObject?: boolean } = {},
): Promise<Record<string, unknown>> {
  const text = await boundedUtf8Body(request, limit);
  try {
    return jsonObject.parse(JSON.parse(text || (options.emptyObject ? "{}" : text)));
  } catch {
    throw invalidBody();
  }
}
