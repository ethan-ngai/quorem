import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  ImageExecutionUncertain,
  type ImageFormat,
  type ImageProcessingResult,
  type ImageProcessor,
} from "../image-processing.ts";

export function isolatedImageProcessor(timeoutMs = 10000): ImageProcessor {
  return {
    process(
      bytes: Uint8Array,
      expected: ImageFormat,
      signal?: AbortSignal,
    ): Promise<ImageProcessingResult> {
      if (bytes.length > 5 * 1024 * 1024) return Promise.resolve({ kind: "invalid" });
      return new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [fileURLToPath(new URL("./image-supervisor.ts", import.meta.url)), expected],
          {
            env: {},
            stdio: ["pipe", "pipe", "ignore", "ipc"],
          },
        );
        const chunks: Buffer[] = [];
        let length = 0;
        let failed = false;
        let terminated = false;
        child.on("message", (message: unknown) => {
          if (
            message &&
            typeof message === "object" &&
            "kind" in message &&
            message.kind === "image-child-terminated"
          )
            terminated = true;
        });
        const stop = () => {
          failed = true;
          if (child.connected) child.send({ stop: true }, () => {});
        };
        const timer = setTimeout(stop, timeoutMs);
        signal?.addEventListener("abort", stop, { once: true });
        if (signal?.aborted) stop();
        child.stdout!.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > 8 * 1024 * 1024) stop();
          else chunks.push(chunk);
        });
        child.stdin!.on("error", () => {});
        child.on("error", () => {
          failed = true;
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", stop);
          if (!terminated)
            return reject(new ImageExecutionUncertain("Image child termination unconfirmed"));
          if (failed || code !== 0) return reject(new Error("Image execution failed"));
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString()) as {
              kind: string;
              bytes?: string;
            };
            if (result.kind === "processed" && typeof result.bytes === "string")
              return resolve({ kind: "processed", bytes: Buffer.from(result.bytes, "base64") });
            if (result.kind === "unsupported" || result.kind === "invalid")
              return resolve({ kind: result.kind });
          } catch {
            /* Invalid child response. */
          }
          reject(new Error("Image execution failed"));
        });
        child.stdin!.end(bytes);
      });
    },
  };
}
