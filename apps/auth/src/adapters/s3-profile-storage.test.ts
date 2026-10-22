import { beforeEach, describe, expect, it, vi } from "vitest";
const { send, configurations } = vi.hoisted(() => ({
  send: vi.fn(),
  configurations: [] as unknown[],
}));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(config: unknown) {
      configurations.push(config);
    }
    send = send;
  },
  PutObjectCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  GetObjectCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  DeleteObjectCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));
import { s3ProfileStorage, r2ProfileStorage } from "./s3-profile-storage";
const key = "12345678-1234-1234-1234-123456789abc";
describe("private profile storage adapters", () => {
  beforeEach(() => {
    send.mockReset();
    configurations.length = 0;
  });
  it.each(["s3", "r2"])("shares the same photo contract on %s", async (driver) => {
    const storage =
      driver === "s3"
        ? s3ProfileStorage("photos", { region: "us-east-1" })
        : r2ProfileStorage({
            bucket: "photos",
            accountId: "a".repeat(32),
            accessKeyId: "key",
            secretAccessKey: "secret",
          });
    const image = new Uint8Array([1, 2, 3]);
    send.mockResolvedValueOnce({});
    await storage.put(key, image);
    expect(send.mock.calls[0][0].input).toEqual({
      Bucket: "photos",
      Key: `avatars/${key}.webp`,
      Body: image,
      ContentType: "image/webp",
    });
    send.mockResolvedValueOnce({
      ContentLength: 3,
      Body: {
        transformToWebStream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(image);
              controller.close();
            },
          }),
      },
    });
    expect([...(await storage.get(key))!]).toEqual([...image]);
    send.mockRejectedValueOnce({ name: "NoSuchKey" });
    expect(await storage.get(key)).toBeUndefined();
    send.mockResolvedValueOnce({});
    await storage.remove(key);
    expect(send.mock.lastCall?.[0].input).toEqual({ Bucket: "photos", Key: `avatars/${key}.webp` });
    if (driver === "r2")
      expect(configurations[0]).toMatchObject({
        region: "auto",
        endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: "key", secretAccessKey: "secret" },
      });
    else expect(configurations[0]).not.toHaveProperty("credentials");
  });
  it("rejects oversized objects, arbitrary keys and provider failures", async () => {
    const storage = s3ProfileStorage("photos", { region: "us-east-1" });
    send.mockResolvedValueOnce({
      ContentLength: 6 * 1024 * 1024,
      Body: { transformToWebStream: () => new ReadableStream() },
    });
    await expect(storage.get(key)).rejects.toThrow("Photo storage unavailable");
    send.mockResolvedValueOnce({
      Body: {
        transformToWebStream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(6 * 1024 * 1024));
            },
          }),
      },
    });
    await expect(storage.get(key)).rejects.toThrow("Photo storage unavailable");
    await expect(storage.get("../secret")).rejects.toThrow("Photo storage unavailable");
    send.mockRejectedValueOnce(new Error("private bucket credentials"));
    await expect(storage.remove(key)).rejects.toThrow("Photo storage unavailable");
  });
});
