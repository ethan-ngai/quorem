import { sharpImageProcessor } from "./sharp-image.ts";
import type { ImageFormat } from "../image-processing.ts";

const chunks: Buffer[] = [];
let size = 0;
for await (const chunk of process.stdin) {
  const bytes = Buffer.from(chunk);
  size += bytes.length;
  if (size > 5 * 1024 * 1024) process.exit(2);
  chunks.push(bytes);
}
const format = process.argv[2];
if (format !== "png" && format !== "jpeg" && format !== "webp") process.exit(2);
const result = await sharpImageProcessor.process(Buffer.concat(chunks), format as ImageFormat);
process.stdout.write(
  JSON.stringify(
    result.kind === "processed"
      ? { kind: result.kind, bytes: Buffer.from(result.bytes).toString("base64") }
      : result,
  ),
);
