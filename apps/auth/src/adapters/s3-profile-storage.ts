import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import type { ProfileStorage } from "../profile-storage.ts";
import { photoObjectPath } from "../profile-object-key.ts";

export function s3ProfileStorage(bucket: string, config: S3ClientConfig): ProfileStorage {
  const client = new S3Client({
    ...config,
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
    // Garage and R2 support ordinary S3 operations; optional checksum extensions vary.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const objectKey = (key: string) => {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid photo key");
    return photoObjectPath(key);
  };
  return {
    async put(key, image) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: objectKey(key),
            Body: image,
            ContentType: "image/webp",
          }),
        );
      } catch {
        throw new Error("Photo storage unavailable");
      }
    },
    async get(key) {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: objectKey(key) }),
        );
        if (!result.Body) return undefined;
        const reader = result.Body.transformToWebStream().getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          if ((result.ContentLength ?? 0) > 5 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("Photo too large");
          }
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 5 * 1024 * 1024) {
              await reader.cancel();
              throw new Error("Photo too large");
            }
            chunks.push(value);
          }
          return Buffer.concat(chunks, size);
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        if ((error as { name?: string }).name === "NoSuchKey") return undefined;
        throw new Error("Photo storage unavailable");
      }
    },
    async remove(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
      } catch {
        throw new Error("Photo storage unavailable");
      }
    },
  };
}

export function r2ProfileStorage(config: {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}): ProfileStorage {
  return s3ProfileStorage(config.bucket, {
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}
