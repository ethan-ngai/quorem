/** @file collaboration.ts @description Versioned CodeMirror collaboration with durable retry and rebasing. @module interviews */
import { collab, getSyncedVersion, receiveUpdates, sendableUpdates } from "@codemirror/collab";
import { ChangeSet, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { InterviewDocument, InterviewUpdates } from "@quorem/contracts";
import { presenceExtension } from "./presence";
import { InterviewError, interviewRequest } from "./api";

export type CollaborationStatus = "connected" | "connecting" | "offline" | "replaced";

/** @returns A single mounted-document controller; local edits survive transport failures. */
export function createCollaboration(
  id: string,
  document: InterviewDocument,
  onStatus: (status: CollaborationStatus) => void,
) {
  const clientID = crypto.randomUUID();
  let view: EditorView | undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  let retry:
    | {
        key: string;
        body: { epoch: string; version: number; updates: { clientID: string; changes: unknown }[] };
      }
    | undefined;
  let lastStatus: CollaborationStatus | undefined;
  function status(value: CollaborationStatus) {
    if (value !== lastStatus) {
      lastStatus = value;
      onStatus(value);
    }
  }
  function apply(response: InterviewUpdates) {
    if (!view || disposed) return;
    if (response.epoch !== document.epoch) {
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
    if (!view) return;
    const version = getSyncedVersion(view.state);
    const response = await interviewRequest<InterviewUpdates>(
      `/v1/interviews/${id}/updates?version=${version}&epoch=${encodeURIComponent(document.epoch)}`,
    );
    apply(response);
  }
  async function synchronize() {
    if (!view || disposed) return;
    try {
      if (!retry) {
        const updates = sendableUpdates(view.state).slice(0, 32);
        if (updates.length)
          retry = {
            key: crypto.randomUUID(),
            body: {
              epoch: document.epoch,
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
          const response = await interviewRequest<InterviewUpdates>(
            `/v1/interviews/${id}/updates`,
            "POST",
            retry.body,
            retry.key,
          );
          apply(response);
          retry = undefined;
        } catch (error) {
          if (
            !(error instanceof InterviewError) ||
            error.status !== 409 ||
            error.code === "document_changed"
          )
            throw error;
          retry = undefined;
          await pull();
        }
      } else await pull();
      if (!disposed) status("connected");
    } catch (error) {
      if (
        error instanceof InterviewError &&
        (error.code === "document_changed" ||
          error.code === "document_replaced" ||
          error.code === "stale_epoch")
      ) {
        status("replaced");
        disposed = true;
      } else status("offline");
    }
  }
  function run() {
    if (active) return active;
    active = synchronize().finally(() => {
      active = undefined;
    });
    return active;
  }
  function schedule(delay = 300) {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void run().finally(() => schedule());
    }, delay);
  }
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(editor: EditorView) {
        view = editor;
        disposed = false;
        status("connecting");
        schedule(0);
      }
      update(update: ViewUpdate) {
        if (update.docChanged) schedule(40);
      }
      destroy() {
        disposed = true;
        clearTimeout(timer);
        view = undefined;
      }
    },
  );
  return {
    extension: [
      collab({ startVersion: document.version, clientID }),
      plugin,
      presenceExtension(id, document.epoch, clientID),
    ] as Extension,
    /** @returns Whether all local changes are acknowledged before execution. */
    async flush() {
      for (let attempt = 0; attempt < 8 && view && !disposed; attempt++) {
        await run();
        if (!sendableUpdates(view.state).length) return true;
        if (lastStatus === "offline") return false;
      }
      return false;
    },
  };
}
