/** @file verifier.ts @description Private Node verification process. @module runner */
import { verifierConfig } from "./config.ts";
import { accessFetch } from "@quorem/execution/transport/access";
import { listenPrivate } from "./server.ts";
import { createVerificationService } from "../verification/service.ts";

export async function startVerifier(env: NodeJS.ProcessEnv) {
  const config = await verifierConfig(env);
  const verify = createVerificationService({
    ...config,
    fetch: accessFetch(config.sourceOrigin, config.access),
  });
  return listenPrivate(config.listen, async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "cache-control": "no-store" }).end();
      return;
    }
    await verify(request, response);
  });
}
if (import.meta.main) {
  try {
    const service = await startVerifier(process.env);
    let closing = false;
    const stop = () => {
      if (closing) return;
      closing = true;
      void service.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch {
    console.error("Verifier startup failed");
    process.exitCode = 1;
  }
}
