/** @file input.ts @description Reopenable, digest-bound sandbox input streams. @module runner */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
export interface CaseInput {
  readonly size: number;
  readonly hash: string;
  open(): AsyncIterable<Uint8Array>;
}
/** Snapshot bounded in-memory inputs so subsequent mutation cannot change a signed request. */
export function bytesInput(value: Uint8Array): CaseInput {
  const bytes = new Uint8Array(value),
    hash = createHash("sha256").update(bytes).digest("hex");
  return { size: bytes.length, hash, open: () => Readable.from([bytes]) };
}
/** Verify the declared stream identity while sending; mismatches invalidate the attempt. */
export async function* checkedInput(input: CaseInput): AsyncGenerator<Uint8Array> {
  const digest = createHash("sha256");
  let size = 0;
  for await (const part of input.open()) {
    if (!(part instanceof Uint8Array)) throw new Error("Invalid sandbox input");
    size += part.byteLength;
    if (size > input.size) throw new Error("Sandbox input size mismatch");
    digest.update(part);
    yield part;
  }
  if (size !== input.size || digest.digest("hex") !== input.hash)
    throw new Error("Sandbox input digest mismatch");
}
