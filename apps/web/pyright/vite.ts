/** @file vite.ts @description Serves the lazy Pyright asset in development and production. @module editor */
import type { Plugin } from "vite-plus";
import { buildPyrightWorker } from "./build.ts";

const workerModule = "virtual:quorem-pyright-worker";
const workerId = `\0${workerModule}`;

/** Keep the Pyright worker outside the editor bundle. */
export function pyrightWorker(): Plugin {
  let worker: Promise<Uint8Array> | undefined;
  let developmentUrl: string;
  let serving: boolean;

  return {
    name: "quorem-pyright-worker",
    configResolved(config) {
      serving = config.command === "serve";
      developmentUrl = `${config.base}__quorem-pyright-worker.js`;
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url !== developmentUrl) return next();
        try {
          worker ??= buildPyrightWorker();
          const source = await worker;
          response.setHeader("Content-Type", "text/javascript");
          response.end(source);
        } catch (error) {
          worker = undefined;
          next(error);
        }
      });
    },
    resolveId(id) {
      if (id === workerModule) return workerId;
    },
    async load(id) {
      if (id !== workerId) return;
      if (serving) return `export default ${JSON.stringify(developmentUrl)};`;
      worker ??= buildPyrightWorker();
      const reference = this.emitFile({
        type: "asset",
        name: "pyright.worker.js",
        source: await worker,
      });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
  };
}
