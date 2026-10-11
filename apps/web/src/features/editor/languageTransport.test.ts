/** @file languageTransport.test.ts @description Pending request and late notification teardown regressions. @module editor */
import { describe, expect, it } from "vitest";
import { languageTransport } from "./languageTransport";
import { PythonLanguageClient } from "./pythonLanguageClient";

class Socket extends EventTarget {
  readyState = 1;
  messages: { id?: number; method?: string; params?: unknown }[] = [];
  send(text: string) {
    this.messages.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
  }
  reply(id: number, result: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id, result }) }));
  }
}

async function initialized() {
  const socket = new Socket();
  const transport = languageTransport(socket as unknown as WebSocket);
  const client = new PythonLanguageClient({ timeout: 30 });
  client.connect(transport);
  socket.reply(1, { capabilities: {} });
  await client.initializing;
  return { socket, transport, client };
}

describe("language transport lifecycle", () => {
  it("settles pending intelligence and ignores notifications queued before close", async () => {
    const { socket, transport, client } = await initialized();
    const completion = client.request("textDocument/completion", {});
    const signature = client.request("textDocument/signatureHelp", {});
    await Promise.resolve();
    client.notification("textDocument/didChange", {});
    socket.close();
    transport.dispose();
    client.disconnect();
    expect(await completion).toBeNull();
    expect(await signature).toBeNull();
    expect(await client.request("textDocument/hover", {})).toBeNull();
    client.notification("textDocument/didClose", {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(socket.messages.map((message) => message.method)).not.toContain(
      "textDocument/didChange",
    );
    expect(socket.messages.map((message) => message.method)).not.toContain("textDocument/didClose");
  });

  it("handles initialization teardown with queued document notifications", async () => {
    const socket = new Socket();
    const transport = languageTransport(socket as unknown as WebSocket);
    const client = new PythonLanguageClient({ timeout: 30 });
    client.connect(transport);
    const initializing = client.initializing.catch((error: unknown) => error);
    client.notification("textDocument/didOpen", {});
    socket.close();
    transport.dispose();
    client.disconnect();
    expect(await initializing).toMatchObject({ message: "Language connection closed" });
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it("dismisses automatic intelligence after request timeout without unhandled rejections", async () => {
    const { transport, client } = await initialized();
    expect(await client.request("textDocument/signatureHelp", {})).toBeNull();
    transport.dispose();
    client.disconnect();
  });

  it("requests a reconnect after consecutive timeouts on an open socket", async () => {
    const socket = new Socket();
    const transport = languageTransport(socket as unknown as WebSocket);
    let outages = 0;
    const client = new PythonLanguageClient({ timeout: 20 }, () => outages++);
    client.connect(transport);
    socket.reply(1, { capabilities: {} });
    await client.initializing;
    await client.request("textDocument/hover", {});
    expect(outages).toBe(0);
    await client.request("textDocument/signatureHelp", {});
    expect(outages).toBe(1);
    transport.dispose();
    client.disconnect();
  });

  it("ignores malformed server frames without breaking the next response", async () => {
    const { socket, transport, client } = await initialized();
    const hover = client.request("textDocument/hover", {});
    await Promise.resolve();
    socket.dispatchEvent(new MessageEvent("message", { data: "invalid JSON" }));
    socket.dispatchEvent(new MessageEvent("message", { data: "null" }));
    socket.reply(2, { contents: "valid" });
    expect(await hover).toEqual({ contents: "valid" });
    transport.dispose();
    client.disconnect();
  });
});
