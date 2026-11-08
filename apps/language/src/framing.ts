/** @file framing.ts @description Bounded stdio JSON-RPC framing. @module language */
const maximumFrameBytes = 2 * 1024 * 1024;
const maximumHeaderBytes = 4096;
const separator = "\r\n\r\n";

/** Encode a JSON message for language-server stdio. @returns Length-prefixed frame. */
export function encodeFrame(message: string): Buffer {
  const body = Buffer.from(message, "utf8");
  if (body.length > maximumFrameBytes) throw new Error("Language message exceeds limit");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

/** Decode fragmented stdio frames without retaining unbounded output. */
export class FrameDecoder {
  private header = Buffer.alloc(0);
  private body: Buffer | undefined;
  private received = 0;

  /** Decode complete messages, retaining a partial frame. @returns Complete JSON strings. */
  push(chunk: Buffer): string[] {
    const messages: string[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.body) {
        const end = Math.min(
          chunk.length,
          offset + maximumHeaderBytes + separator.length - this.header.length,
        );
        const header = Buffer.concat([this.header, chunk.subarray(offset, end)]);
        const boundary = header.indexOf(separator);
        if (boundary < 0) {
          if (
            header.length > maximumHeaderBytes &&
            !separator.startsWith(header.subarray(maximumHeaderBytes).toString("latin1"))
          )
            throw new Error("Invalid language frame header");
          this.header = header;
          break;
        }
        const length = frameLength(header.subarray(0, boundary).toString("ascii"));
        this.body = Buffer.allocUnsafe(length);
        offset += boundary + separator.length - this.header.length;
        this.header = Buffer.alloc(0);
      }
      const end = Math.min(chunk.length, offset + this.body.length - this.received);
      this.received += chunk.copy(this.body, this.received, offset, end);
      offset = end;
      if (this.received < this.body.length) break;
      const message = new TextDecoder("utf-8", { fatal: true }).decode(this.body);
      JSON.parse(message);
      messages.push(message);
      this.body = undefined;
      this.received = 0;
    }
    return messages;
  }

  finish(): void {
    if (this.header.length || this.body) throw new Error("Truncated language frame");
  }
}

function frameLength(header: string): number {
  if (header.split("\r\n").some((line) => !line.includes(":")))
    throw new Error("Invalid language frame header");
  const lengths = [...header.matchAll(/^Content-Length:\s*(\d+)\s*$/gim)];
  if (lengths.length !== 1) throw new Error("Invalid language frame length");
  const length = Number(lengths[0][1]);
  if (!Number.isSafeInteger(length) || length > maximumFrameBytes)
    throw new Error("Language frame exceeds limit");
  return length;
}
