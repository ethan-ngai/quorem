import sharp from "sharp";
import type { ImageProcessor } from "../image-processing.ts";

export const sharpImageProcessor: ImageProcessor = {
  async process(bytes, expected) {
    try {
      const source = sharp(bytes, { limitInputPixels: 16000000, failOn: "warning" });
      const metadata = await source.metadata();
      if (metadata.format !== expected || (metadata.pages ?? 1) !== 1)
        return { kind: "unsupported" };
      // Re-encoding strips metadata and active payloads; original bytes are never served.
      const output = await source
        .rotate()
        .resize(512, 512, { fit: "cover", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      return { kind: "processed", bytes: output };
    } catch {
      return { kind: "invalid" };
    }
  },
};
