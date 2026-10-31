import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { once } from "node:events";
import sharp from "sharp";
import { createImageService } from "./image-service.ts";
import { isolatedImageProcessor } from "./adapters/isolated-image.ts";
import { remoteImageProcessor } from "./adapters/remote-image.ts";
import { ImageExecutionUncertain } from "./image-processing.ts";

const token = "fixture-token-".repeat(3);
const server = createImageService({ token, local: true });
let origin: string;
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
});
afterAll(async () => {
  server.close();
  await once(server, "close");
});
describe("isolated media executor", () => {
  it("runs real Sharp via child and private HTTP; rotates and strips metadata", async () => {
    const input = await sharp({ create: { width: 20, height: 40, channels: 3, background: "red" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const output = await remoteImageProcessor(origin, token, fetch, true).process(input, "jpeg");
    expect(output.kind).toBe("processed");
    if (output.kind !== "processed") throw new Error("missing output");
    const metadata = await sharp(output.bytes).metadata();
    expect([metadata.format, metadata.width, metadata.height, metadata.orientation]).toEqual([
      "webp",
      40,
      20,
      undefined,
    ]);
    expect(
      (await fetch(origin, { method: "POST", headers: { authorization: "Bearer wrong" } })).status,
    ).toBe(401);
    expect(
      (await remoteImageProcessor(origin, token, fetch, true).process(input, "png")).kind,
    ).toBe("unsupported");
  });
  it("authenticates over actual TLS", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quorem-media-tls-"));
    const keyPath = join(dir, "key.pem"),
      certPath = join(dir, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    const key = await readFile(keyPath),
      cert = await readFile(certPath);
    const tlsServer = createImageService({ token, local: false, tls: { key, cert } });
    try {
      tlsServer.listen(0, "127.0.0.1");
      await once(tlsServer, "listening");
      const port = (tlsServer.address() as { port: number }).port;
      const input = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
        .png()
        .toBuffer();
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = httpsRequest(
          {
            hostname: "127.0.0.1",
            port,
            method: "POST",
            ca: cert,
            headers: { authorization: `Bearer ${token}`, "x-image-format": "png" },
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode));
          },
        );
        req.on("error", reject);
        req.end(input);
      });
      expect(status).toBe(200);
    } finally {
      tlsServer.close();
      await once(tlsServer, "close");
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("kills and waits for the child before abort settles", async () => {
    const signal = new AbortController();
    const input = await sharp({
      create: { width: 3000, height: 3000, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const result = isolatedImageProcessor().process(input, "png", signal.signal);
    setTimeout(() => signal.abort(), 20);
    await expect(result).rejects.toThrow();
  });
  it("keeps transport failures uncertain and rejects unsafe configuration", async () => {
    await expect(
      remoteImageProcessor(
        origin,
        token,
        async () => {
          throw new Error("lost");
        },
        true,
      ).process(new Uint8Array(), "png"),
    ).rejects.toBeInstanceOf(ImageExecutionUncertain);
    expect(() => remoteImageProcessor("http://example.com/", token)).toThrow();
    expect(() => remoteImageProcessor(origin, "short")).toThrow();
  });
});
