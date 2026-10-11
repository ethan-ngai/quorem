/** @file framing.ts @description Bounded stdio JSON-RPC framing. @module language */
const maximumFrameBytes = 2 * 1024 * 1024;

/** Encode a JSON message for language-server stdio. @returns Length-prefixed frame. */
export function encodeFrame(message: string): Buffer {
  const body = Buffer.from(message, "utf8");
  if (body.length > maximumFrameBytes) throw new Error("Language message exceeds limit");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

/** Decode fragmented stdio frames without retaining unbounded output. */
export class FrameDecoder {
  private pending = Buffer.alloc(0);

  /** Decode complete messages, retaining a partial frame. @returns Complete JSON strings. */
  push(chunk: Buffer): string[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const messages: string[] = [];
    while (this.pending.length) {
      const boundary = this.pending.indexOf("\r\n\r\n");
      if (boundary < 0) {
        if (this.pending.length > 4096) throw new Error("Invalid language frame header");
        break;
      }
      if (boundary > 4096) throw new Error("Invalid language frame header");
      const header = this.pending.subarray(0, boundary).toString("ascii");
      const lengths = [...header.matchAll(/^Content-Length:\s*(\d+)\s*$/gim)];
      if (lengths.length !== 1) throw new Error("Invalid language frame length");
      const length = Number(lengths[0][1]);
      if (!Number.isSafeInteger(length) || length > maximumFrameBytes) {
        throw new Error("Language frame exceeds limit");
      }
      const end = boundary + 4 + length;
      if (this.pending.length < end) break;
      messages.push(this.pending.subarray(boundary + 4, end).toString("utf8"));
      this.pending = this.pending.subarray(end);
    }
    return messages;
  }
}
