import { readFile } from "node:fs/promises";
import { createImageService } from "./image-service.ts";

export async function startImageService(env: NodeJS.ProcessEnv) {
  const host = env.IMAGE_SERVICE_HOST ?? "127.0.0.1";
  const local = ["127.0.0.1", "::1"].includes(host);
  const token = env.IMAGE_SERVICE_TOKEN ?? "";
  if (Boolean(env.IMAGE_SERVICE_TLS_KEY_FILE) !== Boolean(env.IMAGE_SERVICE_TLS_CERT_FILE))
    throw new Error("Image service requires both TLS files");
  const tls =
    env.IMAGE_SERVICE_TLS_KEY_FILE && env.IMAGE_SERVICE_TLS_CERT_FILE
      ? {
          key: await readFile(env.IMAGE_SERVICE_TLS_KEY_FILE),
          cert: await readFile(env.IMAGE_SERVICE_TLS_CERT_FILE),
        }
      : undefined;
  const port = Number(env.IMAGE_SERVICE_PORT ?? "8083");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid image service port");
  const server = createImageService({ token, local, tls });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
if (import.meta.main) await startImageService(process.env);
