import { PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { photoObjectPath, validPhotoKey } from "../profile-object-key.ts";
import type { PhotoCutoverDestination } from "../profile-object-cutover.ts";
import { s3ProfileStorage } from "./s3-profile-storage.ts";

/** Conditional creation prevents a concurrent writer from being overwritten. */
export function profileObjectS3(bucket: string, config: S3ClientConfig): PhotoCutoverDestination {
  const read = s3ProfileStorage(bucket, config);
  const client = new S3Client({
    ...config,
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    get: (key) => read.get(key),
    async putIfAbsent(key, bytes) {
      if (!validPhotoKey(key) || bytes.byteLength > 5 * 1024 * 1024)
        throw new Error("Invalid photo");
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: photoObjectPath(key),
            Body: bytes,
            ContentType: "image/webp",
            IfNoneMatch: "*",
          }),
        );
        return true;
      } catch (error) {
        const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (failure.name === "PreconditionFailed" || failure.$metadata?.httpStatusCode === 412)
          return false;
        throw new Error("Photo storage unavailable");
      }
    },
  };
}
