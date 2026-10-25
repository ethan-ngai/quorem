/** @file documentSync.ts @description Transport-neutral CodeMirror authority synchronization. @module collaboration */
import { collab, getSyncedVersion, receiveUpdates, sendableUpdates } from "@codemirror/collab";
import { ChangeSet } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { randomUUID } from "../../randomUUID";

export type CollaborationStatus = "connected" | "connecting" | "offline" | "replaced";
export type DocumentUpdate = { clientID: string; changes: unknown };
export type DocumentUpdates = { epoch: string; version: number; updates: DocumentUpdate[] };
export type DocumentPush = { epoch: string; version: number; updates: DocumentUpdate[] };
export type SynchronizedDocument = {
  view: EditorView;
  pull: () => Promise<void>;
  schedule: (delay?: number) => void;
};

type DocumentSyncOptions = {
  document: { version: number; epoch: string };
  clientID: string;
  pull: (position: { epoch: string; version: number }) => Promise<DocumentUpdates>;
  push: (body: DocumentPush, key: string) => Promise<DocumentUpdates>;
  classifyError: (error: unknown) => "stale" | "replaced" | "offline";
  onStatus: (status: CollaborationStatus) => void;
  onSynchronized?: (document: SynchronizedDocument) => Promise<void>;
  onMount?: (view: EditorView) => void;
  onDestroy?: () => void;
};

/** @returns Mounted-document synchronization; retry keys survive lost acknowledgments. */
export function createDocumentSync(options: DocumentSyncOptions) {
  let view: EditorView | undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  let rerun = false;
  let retry:
    | {
        key: string;
        body: DocumentPush;
      }
    | undefined;
  let lastStatus: CollaborationStatus | undefined;
  function status(value: CollaborationStatus) {
    if (value !== lastStatus) {
      lastStatus = value;
      options.onStatus(value);
    }
  }
  function apply(response: DocumentUpdates) {
    if (!view || disposed) return;
    if (response.epoch !== options.document.epoch) {
      status("replaced");
      disposed = true;
      return;
    }
    if (response.updates.length)
      view.dispatch(
        receiveUpdates(
          view.state,
          response.updates.map((update) => ({
            clientID: update.clientID,
            changes: ChangeSet.fromJSON(update.changes),
          })),
        ),
      );
  }
  async function pull() {
    if (!view || disposed) return;
    const version = getSyncedVersion(view.state);
    const response = await options.pull({
      version,
      epoch: options.document.epoch,
    });
    apply(response);
    if (response.updates.length === 256) await pull();
  }
  async function synchronize() {
    if (!view || disposed) return;
    try {
      if (!retry) {
        const updates = sendableUpdates(view.state).slice(0, 32);
        if (updates.length)
          retry = {
            key: randomUUID(),
            body: {
              epoch: options.document.epoch,
              version: getSyncedVersion(view.state),
              updates: updates.map((update) => ({
                clientID: update.clientID,
                changes: update.changes.toJSON(),
              })),
            },
          };
      }
      if (retry) {
        try {
          const response = await options.push(retry.body, retry.key);
          apply(response);
          retry = undefined;
        } catch (error) {
          if (options.classifyError(error) !== "stale") throw error;
          retry = undefined;
          await pull();
        }
      } else await pull();
      if (view && !disposed && !retry && !sendableUpdates(view.state).length)
        await options.onSynchronized?.({ view, pull, schedule });
      if (!disposed) {
        status("connected");
        if (view && sendableUpdates(view.state).length) schedule(0);
      }
    } catch (error) {
      if (disposed) return;
      if (options.classifyError(error) === "replaced") {
        status("replaced");
        disposed = true;
      } else status("offline");
    }
  }
  function run() {
    if (active) {
      rerun = true;
      return active;
    }
    active = synchronize().finally(() => {
      active = undefined;
      if (rerun) {
        rerun = false;
        schedule();
      }
    });
    return active;
  }
  function schedule(delay = 0) {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void run();
    }, delay);
  }
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(editor: EditorView) {
        view = editor;
        disposed = false;
        status("connecting");
        options.onMount?.(editor);
      }
      update(update: ViewUpdate) {
        if (update.docChanged) schedule(40);
      }
      destroy() {
        disposed = true;
        clearTimeout(timer);
        options.onDestroy?.();
        view = undefined;
      }
    },
  );
  return {
    schedule,
    connectionChanged(connected: boolean) {
      if (!disposed) status(connected ? "connecting" : "offline");
    },
    isSynchronized: () => !!view && !disposed && !retry && !sendableUpdates(view.state).length,
    extension: [
      collab({ startVersion: options.document.version, clientID: options.clientID }),
      plugin,
    ],
    /** @returns Whether all local changes are acknowledged before execution. */
    async flush(this: void) {
      for (let attempt = 0; attempt < 8 && view && !disposed; attempt++) {
        await run();
        if (!view || disposed) return false;
        if (!sendableUpdates(view.state).length) return true;
        if (lastStatus === "offline") return false;
      }
      return false;
    },
  };
}
