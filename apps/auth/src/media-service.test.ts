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
import { startImageService } from "./image-service-main.ts";
import { networkInterfaces } from "node:os";
import { accessFetch } from "@quorem/execution/transport/access";

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
  it("requires explicit private container transport for nonloopback and serves authenticated health and Sharp", async () => {
    await expect(
      startImageService({ IMAGE_SERVICE_HOST: "0.0.0.0", IMAGE_SERVICE_TOKEN: token }),
    ).rejects.toThrow();
    await expect(
      startImageService({
        IMAGE_SERVICE_HOST: "127.0.0.1",
        IMAGE_SERVICE_TRANSPORT: "cloudflare-container",
        IMAGE_SERVICE_TOKEN: token,
      }),
    ).rejects.toThrow();
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((entry) => entry && entry.family === "IPv4" && !entry.internal);
    expect(addresses.length).toBeGreaterThan(0);
    const container = createImageService({
      token,
      local: false,
      transport: "cloudflare-container",
    });
    container.listen(0, "0.0.0.0");
    await once(container, "listening");
    const base = `http://${addresses[0]!.address}:${(container.address() as { port: number }).port}`;
    try {
      expect((await fetch(`${base}/health`)).status).toBe(401);
      expect(
        (await fetch(`${base}/health`, { headers: { authorization: `Bearer ${token}` } })).status,
      ).toBe(200);
      const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
        .png()
        .toBuffer();
      const response = await fetch(`${base}/`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "x-image-format": "png" },
        body: input,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("x-image-execution")).toBe("terminated");
      expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format).toBe(
        "webp",
      );
    } finally {
      container.close();
      await once(container, "close");
    }
  });
  it("attaches purpose-scoped Access headers only to the configured HTTPS image origin", async () => {
    let calls = 0;
    const send: typeof fetch = async (input, init) => {
      calls++;
      expect(input instanceof Request ? input.url : input.toString()).toBe(
        "https://media.example/",
      );
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${token}`);
      expect(headers.get("cf-access-client-id")).toBe("fixture-id");
      expect(headers.get("cf-access-client-secret")).toBe("fixture-secret");
      expect(init?.redirect).toBe("error");
      return new Response(new Uint8Array([1]), { headers: { "x-image-execution": "terminated" } });
    };
    const client = accessFetch(
      "https://media.example/",
      { id: "fixture-id", secret: "fixture-secret" },
      send,
    )!;
    expect(
      (
        await remoteImageProcessor("https://media.example/", token, client).process(
          new Uint8Array([1]),
          "png",
        )
      ).kind,
    ).toBe("processed");
    await expect(client("https://other.example/")).rejects.toThrow();
    expect(calls).toBe(1);
  });
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
  it("rejects oversized input before starting an executor", async () => {
    const response = await fetch(origin, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-image-format": "png" },
      body: new Uint8Array(5 * 1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get("x-image-execution")).toBe("terminated");
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
  it("bounds responses, refuses redirects and sends authenticated manual requests", async () => {
    let cancelled = 0;
    const stream = () =>
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      });
    const remote = remoteImageProcessor("https://media.example/", token, async (_url, init) => {
      expect(init?.redirect).toBe("manual");
      expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(stream(), { status: 302, headers: { Location: "https://evil.test/" } });
    });
    await expect(remote.process(new Uint8Array(), "png")).rejects.toBeInstanceOf(
      ImageExecutionUncertain,
    );
    expect(cancelled).toBe(1);
    const oversized = remoteImageProcessor(
      "https://media.example/",
      token,
      async () =>
        new Response(stream(), {
          headers: { "x-image-execution": "terminated", "content-length": "5242881" },
        }),
    );
    await expect(oversized.process(new Uint8Array(), "png")).rejects.toThrow();
    expect(cancelled).toBe(2);
  });
  it("marks a timed out executor request uncertain", async () => {
    const remote = remoteImageProcessor(
      "https://media.example/",
      token,
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(new Error("timeout")));
        }),
    );
    await expect(remote.process(new Uint8Array(), "png")).rejects.toBeInstanceOf(
      ImageExecutionUncertain,
    );
  }, 15000);
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
