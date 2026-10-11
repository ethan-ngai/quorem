/** @file languageIntegration.test.ts @description Browser LSP client against the real isolated Python engine. @module editor */
/// <reference types="node" />
import { createRequire } from "node:module";
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { expect, it } from "vitest";
import { languageTransport } from "./languageTransport";
import { PythonLanguageClient } from "./pythonLanguageClient";

const NodeSocket = createRequire(new URL("../../../../language/package.json", import.meta.url))(
  "ws",
) as new (url: string, options: { origin: string }) => WebSocket;
const uri = "file:///workspace/main.py";

it.skipIf(process.env.QUOREM_LANGUAGE_TEST !== "true")(
  "browser client supplies capabilities, reopens current source and respects owner takeover",
  async () => {
    const connections: { socket: WebSocket; client: PythonLanguageClient; dispose(): void }[] = [];
    const diagnostics: { version: number; diagnostics: { message: string }[] }[] = [];
    async function connect(takeover = false) {
      const socket = new NodeSocket(
        `ws://127.0.0.1:8081/lsp?user=bob${takeover ? "&takeover=1" : ""}`,
        { origin: "http://localhost:5173" },
      );
      const closed = new Promise<number>((resolve) =>
        socket.addEventListener("close", (event) => resolve(event.code), { once: true }),
      );
      const transport = languageTransport(socket);
      const client = new PythonLanguageClient({
        rootUri: "file:///workspace",
        timeout: 5000,
        notificationHandlers: {
          "textDocument/publishDiagnostics": (_client, params) => {
            diagnostics.push(params);
            return true;
          },
        },
      });
      const dispose = () => {
        transport.dispose();
        client.disconnect();
      };
      connections.push({ socket, client, dispose });
      socket.addEventListener("close", dispose, { once: true });
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      return {
        socket,
        client,
        closed,
        initialize: async () => {
          client.connect(transport);
          await client.initializing;
        },
      };
    }
    const params = (line: number, character: number) => ({
      textDocument: { uri },
      position: { line, character },
    });
    function open(client: PythonLanguageClient, state: EditorState) {
      client.didOpen({
        uri,
        languageId: "python",
        version: 0,
        doc: state.doc,
        getView: () => null,
      });
    }
    try {
      const first = await connect();
      await first.initialize();
      const state = EditorState.create({
        doc: 'from quorem_types import ListNode\nnode = ListNode(2)\nitems: list[str] = []\nwrong: int = "text"\nitems.append(\n',
        extensions: [history()],
      });
      open(first.client, state);
      const completions = await first.client.request<unknown, { items: { label: string }[] }>(
        "textDocument/completion",
        { ...params(4, 6), context: { triggerKind: 2, triggerCharacter: "." } },
      );
      const append = completions.items.find((item) => item.label === "append");
      expect(append).toBeDefined();
      const resolved = await first.client.request<unknown, { documentation: { value: string } }>(
        "completionItem/resolve",
        append,
      );
      expect(resolved.documentation.value).toMatch(/Append object/);
      const hover = await first.client.request<unknown, { contents: { value: string } }>(
        "textDocument/hover",
        params(2, 2),
      );
      expect(hover.contents.value).toContain("list[str]");
      const signature = await first.client.request<unknown, { signatures: { label: string }[] }>(
        "textDocument/signatureHelp",
        params(4, 13),
      );
      expect(signature.signatures[0].label).toContain("object: str");
      await expect
        .poll(
          () =>
            diagnostics.some(
              (item) =>
                item.diagnostics.some((diagnostic) => diagnostic.message.includes("int")) &&
                item.diagnostics.some((diagnostic) => diagnostic.message.includes("not closed")),
            ),
          { timeout: 8000 },
        )
        .toBe(true);

      const duplicate = await connect();
      expect(await duplicate.closed).toBe(4009);
      expect(first.socket.readyState).toBe(1);
      const replacement = await connect(true);
      expect(await first.closed).toBe(4009);
      await replacement.initialize();
      const offline = state.update({
        changes: {
          from: 0,
          to: state.doc.length,
          insert: 'latest: str = "private edit"\nlatest.upper(\n',
        },
        selection: { anchor: 3 },
        userEvent: "input.type",
      }).state;
      open(replacement.client, offline);
      const latestHover = await replacement.client.request<
        unknown,
        { contents: { value: string } }
      >("textDocument/hover", params(0, 2));
      expect(latestHover.contents.value).toContain("private edit");
      expect(offline.selection.main.head).toBe(3);
      const view = {
        state: offline,
        dispatch(transaction: Parameters<EditorState["update"]>[0]) {
          view.state = view.state.update(transaction).state;
        },
      };
      expect(undo(view as unknown as EditorView)).toBe(true);
      expect(view.state.doc.toString()).toBe(state.doc.toString());

      replacement.socket.close();
      await replacement.closed;
      const reopened = await connect();
      await reopened.initialize();
      open(reopened.client, offline);
      const reopenedHover = await reopened.client.request<unknown, { contents: { value: string } }>(
        "textDocument/hover",
        params(0, 2),
      );
      expect(reopenedHover.contents.value).toContain("private edit");
    } finally {
      for (const connection of connections) {
        connection.dispose();
        connection.socket.close();
      }
    }
  },
  30000,
);
