import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { isolatedImageProcessor } from "./adapters/isolated-image";
const sharpImageProcessor = isolatedImageProcessor();

const image = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "red" } });

describe("sharp image processor", () => {
  it("accepts each allowed format and emits stripped WebP", async () => {
    for (const format of ["png", "jpeg", "webp"] as const) {
      const input = await image(32, 16).toFormat(format).toBuffer();
      const result = await sharpImageProcessor.process(input, format);
      expect(result.kind).toBe("processed");
      if (result.kind !== "processed") throw new Error("Expected processed image");
      const metadata = await sharp(result.bytes).metadata();
      expect(metadata).toMatchObject({ format: "webp", width: 32, height: 16 });
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    }
  });
  it("applies orientation, cover crop and prevents enlargement", async () => {
    const rotated = await image(32, 16).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const output = await sharpImageProcessor.process(rotated, "jpeg");
    expect(output.kind).toBe("processed");
    if (output.kind !== "processed") throw new Error("Expected processed image");
    expect(await sharp(output.bytes).metadata()).toMatchObject({ width: 16, height: 32 });
    const large = await image(1200, 800).png().toBuffer();
    const resized = await sharpImageProcessor.process(large, "png");
    expect(resized.kind).toBe("processed");
    if (resized.kind !== "processed") throw new Error("Expected processed image");
    expect(await sharp(resized.bytes).metadata()).toMatchObject({ width: 512, height: 512 });
  });
  it("enforces the 16 megapixel boundary", async () => {
    const accepted = await image(4000, 4000).png().toBuffer();
    expect((await sharpImageProcessor.process(accepted, "png")).kind).toBe("processed");
    const rejected = await image(4001, 4000).png().toBuffer();
    expect((await sharpImageProcessor.process(rejected, "png")).kind).toBe("invalid");
  });
  it("rejects multi-frame WebP", async () => {
    const animated = await sharp(Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]), {
      raw: { width: 1, height: 2, channels: 4, pageHeight: 1 },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    expect(await sharpImageProcessor.process(animated, "webp")).toEqual({ kind: "unsupported" });
  });
  it("distinguishes format mismatch from invalid input", async () => {
    const input = await image(32, 16).png().toBuffer();
    expect(await sharpImageProcessor.process(input, "jpeg")).toEqual({ kind: "unsupported" });
    expect(await sharpImageProcessor.process(new Uint8Array([1, 2, 3]), "png")).toEqual({
      kind: "invalid",
    });
  });
});
