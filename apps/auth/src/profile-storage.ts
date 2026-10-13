import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

export interface ProfileStorage {
  put(key: string, image: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  remove(key: string): Promise<void>;
}

export function s3ProfileStorage(env: NodeJS.ProcessEnv): ProfileStorage | undefined {
  const bucket = env.AVATAR_S3_BUCKET;
  if (!bucket) return undefined;
  if (Boolean(env.AVATAR_S3_ACCESS_KEY_ID) !== Boolean(env.AVATAR_S3_SECRET_ACCESS_KEY))
    throw new Error("Both avatar S3 credentials required");
  const client = new S3Client({
    region: env.AVATAR_S3_REGION ?? "us-east-1",
    ...(env.AVATAR_S3_ENDPOINT ? { endpoint: env.AVATAR_S3_ENDPOINT, forcePathStyle: true } : {}),
    ...(env.AVATAR_S3_ACCESS_KEY_ID
      ? {
          credentials: {
            accessKeyId: env.AVATAR_S3_ACCESS_KEY_ID,
            secretAccessKey: env.AVATAR_S3_SECRET_ACCESS_KEY!,
          },
        }
      : {}),
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
    // Garage implements ordinary S3; optional SDK checksum extensions are unnecessary.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const objectKey = (key: string) => `avatars/${key}.webp`;
  return {
    async put(key, image) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey(key),
          Body: image,
          ContentType: "image/webp",
        }),
      );
    },
    async get(key) {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: objectKey(key) }),
        );
        return await result.Body?.transformToByteArray();
      } catch (error) {
        if ((error as { name?: string }).name === "NoSuchKey") return undefined;
        throw error;
      }
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
    },
  };
}
