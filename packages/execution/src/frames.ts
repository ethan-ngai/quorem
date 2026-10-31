/** @file frames.ts @description Bounded remote sandbox frame decoding. @module execution */
export type OutputChannel = "stdout" | "stderr";
export interface FrameLimits {
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}
/** Decode ordered frames with backpressure; success requires teardown and end-of-stream. */
export async function decodeCaseFrames(
  source: AsyncIterable<Uint8Array>,
  limits: FrameLimits,
  write: (channel: OutputChannel, data: Uint8Array) => Promise<void>,
  signal?: AbortSignal,
): Promise<number> {
  for (const n of [limits.stdoutBytes, limits.stderrBytes])
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("invalid output limit");
  const iterator = source[Symbol.asyncIterator]();
  let pending: Uint8Array = new Uint8Array(0);
  let offset = 0,
    done = false,
    exited = false,
    code = 0;
  let stdout = 0,
    stderr = 0;
  const read = async (size: number): Promise<Uint8Array | null> => {
    const result = new Uint8Array(size);
    let filled = 0;
    while (filled < size) {
      if (signal?.aborted) throw new Error("aborted");
      if (offset === pending.length) {
        if (done)
          return filled === 0
            ? null
            : (() => {
                throw new Error("truncated frame");
              })();
        const next = await iterator.next();
        if (next.done) {
          done = true;
          continue;
        }
        if (!(next.value instanceof Uint8Array)) throw new Error("invalid frame bytes");
        pending = next.value;
        offset = 0;
        if (!pending.length) continue;
      }
      const amount = Math.min(size - filled, pending.length - offset);
      result.set(pending.subarray(offset, offset + amount), filled);
      filled += amount;
      offset += amount;
    }
    return result;
  };
  try {
    while (true) {
      const header = await read(8);
      if (!header) throw new Error(exited ? "truncated after exit" : "truncated before exit");
      const size = new DataView(header.buffer, header.byteOffset, 8).getUint32(4, false),
        channel = header[0];
      if (header[1] || header[2] || header[3] || size > 65536)
        throw new Error("invalid case frame");
      if (channel === 1 || channel === 2) {
        if (exited) throw new Error("output after case exit");
        if (channel === 1) {
          stdout += size;
          if (stdout > limits.stdoutBytes) throw new Error("stdout limit exceeded");
        } else {
          stderr += size;
          if (stderr > limits.stderrBytes) throw new Error("stderr limit exceeded");
        }
        const data = await read(size);
        if (data === null) throw new Error("truncated before exit");
        if (size !== 0) await write(channel === 1 ? "stdout" : "stderr", data);
        continue;
      }
      if (channel === 3) {
        if (size !== 4 || exited) throw new Error("invalid case exit frame");
        const data = await read(4);
        if (data === null) throw new Error("truncated before exit");
        code = new DataView(data.buffer, data.byteOffset, 4).getInt32(0, false);
        exited = true;
        continue;
      }
      if (channel === 4) {
        if (size !== 0 || !exited) throw new Error("invalid case teardown frame");
        if ((await read(1)) !== null) throw new Error("invalid case response ending");
        return code;
      }
      throw new Error("invalid case frame");
    }
  } finally {
    if (!done) await iterator.return?.();
  }
}
