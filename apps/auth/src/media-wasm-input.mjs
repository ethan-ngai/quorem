import sharp from "sharp";
import { writeFile } from "node:fs/promises";
const square = await sharp({
  create: { width: 4000, height: 4000, channels: 3, background: "#9f7" },
})
  .jpeg()
  .toBuffer();
const rotated = await sharp({
  create: { width: 4000, height: 3999, channels: 3, background: "#9f7" },
})
  .jpeg()
  .withMetadata({ orientation: 6 })
  .toBuffer();
await writeFile("/tmp/quorem-wasm-square.jpg", square);
await writeFile("/tmp/quorem-wasm-rotated.jpg", rotated);
