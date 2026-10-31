/** @file input-spool.ts @description Verify paged input before exposing it to a sandbox. @module runner */
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionInputReader, InputBlobRef, InputKind, Job } from "@quorem/execution";

/** Disk spooling bounds trusted Node memory and prevents execution before the final digest check. */
export async function spoolInput(options: {
  reader: ExecutionInputReader;
  job: Job;
  kind: InputKind;
  ordinal: number;
  expected?: InputBlobRef;
  expectedChannel?: "public" | "sample" | "private";
  signal?: AbortSignal;
}) {
  const directory = await mkdtemp(join(tmpdir(), "quorem-input-"));
  const path = join(directory, "value");
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(path, "wx+", 0o600);
    let offset = 0,
      size: number | undefined,
      hash: string | undefined,
      channel: "public" | "sample" | "private" | null | undefined;
    const digest = createHash("sha256");
    do {
      options.signal?.throwIfAborted();
      const page = await options.reader.inputPage(
        options.job,
        options.kind,
        options.ordinal,
        offset,
        options.signal,
      );
      if (size === undefined) {
        size = page.size;
        hash = page.hash;
        channel = page.channel;
      }
      if (
        !Number.isSafeInteger(page.size) ||
        page.size < 0 ||
        page.size > 1073741823 ||
        !/^[a-f0-9]{64}$/.test(page.hash) ||
        (options.kind === "case"
          ? !["public", "sample", "private"].includes(page.channel ?? "")
          : page.channel !== null) ||
        (options.expectedChannel !== undefined && page.channel !== options.expectedChannel) ||
        page.size !== size ||
        page.hash !== hash ||
        page.channel !== channel ||
        page.bytes.length !== Math.min(65536, size - offset) ||
        (options.expected && (options.expected.hash !== hash || options.expected.size !== size))
      )
        throw new Error("Inconsistent runner input");
      digest.update(page.bytes);
      let written = 0;
      while (written < page.bytes.length) {
        const result = await file.write(
          page.bytes,
          written,
          page.bytes.length - written,
          offset + written,
        );
        if (!result.bytesWritten) throw new Error("Input spool unavailable");
        written += result.bytesWritten;
      }
      offset += page.bytes.length;
    } while (offset < size!);
    if (digest.digest("hex") !== hash) throw new Error("Runner input digest mismatch");
    const ready = file;
    let disposed = false;
    return {
      size: size!,
      hash: hash!,
      channel: channel!,
      stream(start = 0, length = size! - start) {
        if (disposed) throw new Error("Input spool closed");
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(length) ||
          start < 0 ||
          length < 0 ||
          start + length > size!
        )
          throw new Error("Invalid input span");
        if (length === 0) return Readable.from([]);
        return createReadStream(path, { start, end: start + length - 1 });
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        try {
          await ready.close();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    try {
      await file?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    throw error;
  }
}
