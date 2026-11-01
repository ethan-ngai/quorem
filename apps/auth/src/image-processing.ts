export type ImageFormat = "png" | "jpeg" | "webp";

export type ImageProcessingResult =
  | { kind: "processed"; bytes: Uint8Array }
  | { kind: "unsupported" }
  | { kind: "invalid" };

export interface ImageProcessor {
  process(bytes: Uint8Array, expected: ImageFormat): Promise<ImageProcessingResult>;
}
