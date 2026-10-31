export type ImageFormat = "png" | "jpeg" | "webp";

export type ImageProcessingResult =
  | { kind: "processed"; bytes: Uint8Array }
  | { kind: "unsupported" }
  | { kind: "invalid" };

export class ImageExecutionUncertain extends Error {}

export interface ImageProcessor {
  process(
    bytes: Uint8Array,
    expected: ImageFormat,
    signal?: AbortSignal,
  ): Promise<ImageProcessingResult>;
}
