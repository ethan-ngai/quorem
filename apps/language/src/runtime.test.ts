/** @file runtime.test.ts @description Real Python language capabilities. @module language */
import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { documentUri } from "./policy.ts";

void test(
  "isolated Python engine supplies completion, hover, signatures and diagnostics",
  {
    skip: process.env.QUOREM_LANGUAGE_TEST !== "true",
    timeout: 30000,
  },
  async () => {
    const socket = new WebSocket("ws://127.0.0.1:8081/lsp?user=bob", {
      origin: "http://localhost:5173",
    });
    const pending = new Map<number, (result: unknown) => void>();
    let nextId = 0;
    let diagnostic: (value: unknown) => void = () => {};
    const diagnostics = new Promise<unknown>((resolve) => {
      diagnostic = resolve;
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(
        (Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as Buffer)).toString("utf8"),
      ) as {
        id?: number;
        result?: unknown;
        method?: string;
        params?: unknown;
      };
      if (message.id !== undefined) pending.get(message.id)?.(message.result);
      if (message.method === "textDocument/publishDiagnostics") diagnostic(message.params);
    });
    const notify = (method: string, params: unknown) =>
      socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
    const request = (method: string, params: unknown) =>
      new Promise<unknown>((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const init = (await request("initialize", {
        processId: null,
        rootUri: "file:///workspace",
        capabilities: {},
      })) as { capabilities: Record<string, unknown> };
      for (const capability of ["completionProvider", "hoverProvider", "signatureHelpProvider"])
        assert.ok(init.capabilities[capability]);
      notify("initialized", {});
      notify("textDocument/didOpen", {
        textDocument: {
          uri: documentUri,
          languageId: "python",
          version: 1,
          text: 'from quorem_types import ListNode\nnode = ListNode(2)\nitems: list[str] = []\nwrong: int = "text"\nitems.append(\n',
        },
      });
      const published = (await diagnostics) as { diagnostics: { message: string }[] };
      assert.ok(published.diagnostics.some((item) => item.message.includes("int")));
      assert.ok(published.diagnostics.some((item) => item.message.includes("not closed")));
      const params = (line: number, character: number) => ({
        textDocument: { uri: documentUri },
        position: { line, character },
      });
      const completion = (await request("textDocument/completion", params(4, 6))) as {
        items: { label: string }[];
      };
      assert.ok(completion.items.some((item) => item.label === "append"));
      const hover = (await request("textDocument/hover", params(2, 2))) as {
        contents: { value: string };
      };
      assert.match(hover.contents.value, /list\[str\]/);
      const nodeHover = (await request("textDocument/hover", params(1, 2))) as {
        contents: { value: string };
      };
      assert.match(nodeHover.contents.value, /ListNode/);
      const signature = (await request("textDocument/signatureHelp", params(4, 13))) as {
        signatures: { label: string }[];
      };
      assert.match(signature.signatures[0].label, /object: str/);
    } finally {
      socket.close();
    }
  },
);
