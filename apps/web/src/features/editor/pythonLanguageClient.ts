/** @file pythonLanguageClient.ts @description Quiet outage handling and lazy completion documentation. @module editor */
import {
  LSPClient,
  LSPPlugin,
  serverCompletionSource,
  type LSPClientConfig,
  type Transport,
} from "@codemirror/lsp-client";
import type { CompletionSource } from "@codemirror/autocomplete";

type CompletionItem = {
  label: string;
  detail?: string;
  documentation?: string | { kind: "markdown" | "plaintext"; value: string };
};
type CompletionResponse = CompletionItem[] | { items: CompletionItem[] } | null;

/** A document-scoped client; outages dismiss transient intelligence requests. */
export class PythonLanguageClient extends LSPClient {
  private active = true;
  private connection: Transport | undefined;
  private timeouts = 0;
  private readonly onUnavailable: () => void;
  private completionResponse: Promise<CompletionResponse> | undefined;

  constructor(config: LSPClientConfig, onUnavailable: () => void = () => {}) {
    super(config);
    this.onUnavailable = onUnavailable;
  }

  override connect(transport: Transport): this {
    this.connection = transport;
    return super.connect(transport);
  }

  override request<Params, Result>(method: string, params: Params): Promise<Result> {
    const response = this.active
      ? super.request<Params, Result>(method, params).then(
          (result) => {
            this.timeouts = 0;
            return result;
          },
          (error: unknown) => {
            if (
              this.active &&
              error instanceof Error &&
              error.message === "Request timed out" &&
              ++this.timeouts >= 2
            )
              this.onUnavailable();
            return null as Result;
          },
        )
      : Promise.resolve(null as Result);
    if (method === "textDocument/completion") {
      this.completionResponse = response as Promise<CompletionResponse>;
    }
    return response;
  }

  override notification(method: string, params: unknown): void {
    if (!this.active) return;
    void this.initializing.then(
      () => {
        if (this.active) this.connection?.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
      },
      () => {},
    );
  }

  override disconnect(): void {
    this.active = false;
    this.connection = undefined;
    super.disconnect();
  }

  private latestCompletion(): Promise<CompletionResponse> | undefined {
    return this.completionResponse;
  }

  readonly completionSource: CompletionSource = (context) => {
    this.completionResponse = undefined;
    const result = serverCompletionSource(context);
    // The source starts its request synchronously; capture that response before another invocation.
    const response = this.latestCompletion();
    return Promise.all([result, response]).then(([completions, raw]) => {
      if (!completions || !raw) return completions;
      const items = Array.isArray(raw) ? raw : raw.items;
      const plugin = context.view && LSPPlugin.get(context.view);
      if (!plugin) return completions;
      return {
        ...completions,
        options: completions.options.map((option, index) => {
          const item = items[index];
          if (option.info || !item) return option;
          let resolved: Promise<CompletionItem | null> | undefined;
          return {
            ...option,
            info: async () => {
              resolved ??= this.request<CompletionItem, CompletionItem | null>(
                "completionItem/resolve",
                item,
              );
              const documentation = (await resolved)?.documentation;
              if (!documentation || !this.active) return null;
              const element = document.createElement("div");
              element.className = "cm-lsp-documentation cm-lsp-completion-documentation";
              element.innerHTML = plugin.docToHTML(documentation);
              return element;
            },
          };
        }),
      };
    });
  };
}
