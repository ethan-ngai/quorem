/** @file languageIntegration.test.ts @description Browser LSP client against the real isolated Python engine. @module editor */
/// <reference types="node" />
import { createRequire } from "node:module";
import { hoverTooltips, signatureHelp, serverDiagnostics } from "@codemirror/lsp-client";
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { expect, it } from "vitest";
import { languageTransport } from "./languageTransport";
import { PythonLanguageClient } from "./pythonLanguageClient";
import runWidths from "../../../../../fixtures/problems/run-widths.json";

const NodeSocket = createRequire(new URL("../../../../language/package.json", import.meta.url))(
  "ws",
) as new (url: string, options: { origin: string }) => WebSocket;
const uri = "file:///workspace/main.py";
const languageURL = process.env.QUOREM_LANGUAGE_TEST_URL ?? "ws://127.0.0.1:8081/lsp";

it.skipIf(process.env.QUOREM_LANGUAGE_TEST !== "true")(
  "browser client supplies capabilities, reopens current source and keeps same-owner documents isolated",
  async () => {
    const connections: {
      socket: WebSocket;
      client: PythonLanguageClient;
      closed: Promise<number>;
      dispose(): void;
    }[] = [];
    const diagnostics: { version: number; diagnostics: { message: string }[] }[] = [];
    async function connect() {
      const socket = new NodeSocket(`${languageURL}?user=bob`, {
        origin: "http://localhost:5173",
      });
      const closed = new Promise<number>((resolve) =>
        socket.addEventListener("close", (event) => resolve(event.code), { once: true }),
      );
      const transport = languageTransport(socket);
      const client = new PythonLanguageClient({
        rootUri: "file:///workspace",
        timeout: 5000,
        extensions: [
          { clientCapabilities: { workspace: { workspaceFolders: true } } },
          hoverTooltips(),
          signatureHelp(),
          serverDiagnostics(),
        ],
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
      connections.push({ socket, client, closed, dispose });
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

      const replacement = await connect();
      expect(first.socket.readyState).toBe(1);
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
      const originalHover = await first.client.request<unknown, { contents: { value: string } }>(
        "textDocument/hover",
        params(2, 2),
      );
      expect(originalHover.contents.value).toContain("list[str]");
      expect(first.socket.readyState).toBe(1);
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
      await Promise.all(connections.map((connection) => connection.closed));
    }
  },
  30000,
);

it.skipIf(process.env.QUOREM_LANGUAGE_TEST !== "true")(
  "cold Run Widths global completion survives standard-library analysis without cache eviction",
  async () => {
    const socket = new NodeSocket(`${languageURL}?user=bob`, {
      origin: "http://localhost:5173",
    });
    const closed = new Promise<void>((resolve) =>
      socket.addEventListener("close", () => resolve(), { once: true }),
    );
    const transport = languageTransport(socket);
    const cacheEvictions: string[] = [];
    const client = new PythonLanguageClient({
      rootUri: "file:///workspace",
      timeout: 5000,
      extensions: [
        { clientCapabilities: { workspace: { workspaceFolders: true } } },
        hoverTooltips(),
        signatureHelp(),
        serverDiagnostics(),
      ],
      notificationHandlers: {
        "window/logMessage": (_client, params) => {
          if (params.message.includes("Emptying type cache")) cacheEvictions.push(params.message);
          return true;
        },
        "textDocument/publishDiagnostics": () => true,
      },
    });
    socket.addEventListener(
      "close",
      () => {
        transport.dispose();
        client.disconnect();
      },
      { once: true },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      client.connect(transport);
      await client.initializing;
      const source = (prefix: string) =>
        runWidths.problem.starterSource.replace("        pass", `        ${prefix}`);
      client.didOpen({
        uri,
        languageId: "python",
        version: 0,
        doc: EditorState.create({ doc: source("p") }).doc,
        getView: () => null,
      });
      let version = 0;
      for (const prefix of ["p", "pr", "pri", "print", "p", "pr", "pri", "print"]) {
        client.notification("textDocument/didChange", {
          textDocument: { uri, version: ++version },
          contentChanges: [{ text: source(prefix) }],
        });
        const result = await client.request<unknown, { items: { label: string }[] } | null>(
          "textDocument/completion",
          {
            textDocument: { uri },
            position: { line: 5, character: 8 + prefix.length },
            context: { triggerKind: 1 },
          },
        );
        expect(result?.items.some((item) => item.label === "print")).toBe(true);
        expect(socket.readyState).toBe(1);
      }
      expect(cacheEvictions).toEqual([]);
    } finally {
      transport.dispose();
      client.disconnect();
      socket.close();
      await closed;
    }
  },
  20000,
);
