/** @file build.ts @description Bundles pinned Pyright sources and typeshed for the browser. @module editor */
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { constants } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { zipSync, type Zippable } from "fflate";
import { fixNumericAttributeRecovery } from "./parser-fix.ts";

const require = createRequire(import.meta.url);
const pyright = join(
  dirname(require.resolve("pyright-source/package.json")),
  "packages",
  "pyright-internal",
);
const aliases = {
  assert: "assert/",
  events: "events/",
  fs: "@zenfs/core",
  os: "os-browserify/browser",
  path: "path-browserify",
  stream: "stream-browserify",
  url: "url/",
  util: "util/",
  vm: "vm-browserify",
  zlib: "browserify-zlib",
};

/** Collect the pinned stubs with stable archive paths and timestamps. */
async function typeshedFiles(directory: string): Promise<Zippable> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  return Object.fromEntries(
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        return [entry.name, entry.isDirectory() ? await typeshedFiles(path) : await readFile(path)];
      }),
    ),
  );
}

const browserResources: Plugin = {
  name: "pyright-browser-resources",
  setup(bundle) {
    bundle.onResolve({ filter: /^quorem-pyright-typeshed$/ }, ({ path }) => ({
      path,
      namespace: "typeshed",
    }));
    bundle.onLoad({ filter: /.*/, namespace: "typeshed" }, async () => ({
      contents: zipSync(await typeshedFiles(join(pyright, "typeshed-fallback")), {
        mtime: new Date(1980, 0, 1),
      }),
      loader: "binary",
    }));

    bundle.onResolve({ filter: /^quorem-browser-os-constants$/ }, ({ path }) => ({
      path,
      namespace: "os-constants",
    }));
    bundle.onLoad({ filter: /.*/, namespace: "os-constants" }, () => ({
      contents: JSON.stringify(constants),
      loader: "json",
    }));

    // Native execution, background threads and V8 telemetry are unavailable in the worker.
    bundle.onResolve(
      {
        filter:
          /^(?:node:)?(?:child_process|crypto|inspector|perf_hooks|readline|tty|v8|worker_threads)$/,
      },
      () => ({ path: "empty", namespace: "browser-native" }),
    );
    bundle.onLoad({ filter: /.*/, namespace: "browser-native" }, () => ({
      contents: "module.exports = {};",
    }));
    bundle.onLoad({ filter: /[/\\]src[/\\]parser[/\\]parser\.ts$/ }, async ({ path }) => {
      if (path !== join(pyright, "src", "parser", "parser.ts")) return;
      return { contents: fixNumericAttributeRecovery(await readFile(path, "utf8")), loader: "ts" };
    });
  },
};

/** Build a single classic worker that Vite can serve as a standalone asset. */
export async function buildPyrightWorker(): Promise<Uint8Array> {
  const result = await build({
    alias: Object.fromEntries(
      Object.entries(aliases).map(([name, replacement]) => [name, require.resolve(replacement)]),
    ),
    bundle: true,
    define: {
      __dirname: '"/"',
      global: "globalThis",
    },
    entryPoints: [fileURLToPath(new URL("./worker.ts", import.meta.url))],
    inject: [fileURLToPath(new URL("./globals.mjs", import.meta.url))],
    // ZenFS resolves packed filesystem structures by class name.
    keepNames: true,
    legalComments: "inline",
    minify: true,
    nodePaths: [fileURLToPath(new URL("../node_modules", import.meta.url))],
    plugins: [browserResources],
    target: "es2022",
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    write: false,
  });
  return result.outputFiles[0].contents;
}
