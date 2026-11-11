/** @file worker.test.ts @description Exercises diagnostics from the bundled Pyright worker. @module editor */
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import { buildPyrightWorker } from "./build.ts";

const workspace = "file:///typings";
const uri = `${workspace}/main.py`;
const python = [
  "from math import gcd",
  "nums = [1]",
  "valid = (.5 + 1)",
  "gcd((nums[0].0), 1)",
  "gcd(0.5, 1)",
  "broken = (1 + 2",
].join("\n");

interface Diagnostic {
  message: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

/** Open the test document using the same browser messages as the editor. */
async function collectDiagnostics(worker: Worker) {
  const signal = AbortSignal.timeout(10_000);
  return new Promise<Diagnostic[]>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    worker.once("error", reject);
    worker.once("exit", (code) => reject(new Error(`Pyright worker exited with code ${code}`)));
    worker.on("message", (message) => {
      switch (message.type ?? message.method ?? message.id) {
        case "serverLoaded":
          worker.postMessage({
            type: "initServer",
            userFiles: {
              "main.py": "",
              "pyrightconfig.json": '{"pythonVersion":"3.12","typeCheckingMode":"basic"}',
            },
          });
          break;
        case "serverFailed":
          reject(new Error("Pyright worker initialization failed"));
          break;
        case "serverInitialized":
          worker.postMessage({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              capabilities: {},
              rootUri: workspace,
              workspaceFolders: [{ name: "Python", uri: workspace }],
            },
          });
          break;
        case 1:
          if (message.error) {
            reject(new Error(message.error.message));
            break;
          }
          worker.postMessage({ jsonrpc: "2.0", method: "initialized", params: {} });
          worker.postMessage({
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: { textDocument: { uri, languageId: "python", version: 1, text: python } },
          });
          break;
        case "textDocument/publishDiagnostics":
          if (message.params.uri === uri && message.params.diagnostics.length > 0) {
            resolve(message.params.diagnostics);
          }
          break;
      }
    });
  });
}

it("reports numeric attributes without inventing missing parentheses", async () => {
  const bundle = Buffer.from(await buildPyrightWorker()).toString("utf8");
  const worker = new Worker(
    `const { parentPort } = require("node:worker_threads");
    const events = new EventTarget();
    parentPort.on("message", (data) => {
      const event = new MessageEvent("message", { data });
      events.dispatchEvent(event);
      globalThis.onmessage?.(event);
    });
    globalThis.self = globalThis;
    globalThis.addEventListener = events.addEventListener.bind(events);
    globalThis.removeEventListener = events.removeEventListener.bind(events);
    globalThis.postMessage = parentPort.postMessage.bind(parentPort);
    ${bundle}`,
    { eval: true },
  );

  try {
    const diagnostics = await collectDiagnostics(worker);
    const messagesAt = (line: number) =>
      diagnostics.filter((item) => item.range.start.line === line).map((item) => item.message);
    expect(messagesAt(0)).toEqual([]);
    expect(messagesAt(2)).toEqual([]);
    expect(messagesAt(3)).toEqual(['Expected attribute name after "."']);
    const range = diagnostics.find((item) => item.range.start.line === 3)?.range;
    expect(python.split("\n")[3].slice(range?.start.character, range?.end.character)).toBe(".0");
    expect(messagesAt(4)).toEqual([expect.stringContaining('Argument of type "float"')]);
    expect(messagesAt(5)).toContain('"(" was not closed');
  } finally {
    await worker.terminate();
  }
}, 15_000);
