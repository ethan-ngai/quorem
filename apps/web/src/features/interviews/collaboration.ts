import { unlockedMethodEdit } from "../odyssey/methodStubs";
import type { OdysseyProgress } from "@quorem/contracts";
import type { EditorLanguage } from "../editor/editorLanguages";
import { createInterviewRuleReporter } from "./ruleEvents";
/** @file collaboration.ts @description Versioned CodeMirror collaboration with durable retry and rebasing. @module interviews */
import { collab, getSyncedVersion, receiveUpdates, sendableUpdates } from "@codemirror/collab";
import { ChangeSet, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type {
  InterviewDocument,
  InterviewUpdates,
  InterviewSnapshot,
  Submission,
} from "@quorem/contracts";
import { createInterviewSocket } from "./socket";
import { presenceExtension } from "./presence";
import { InterviewError } from "./api";

export type CollaborationStatus = "connected" | "connecting" | "offline" | "replaced";

/** @returns A single mounted-document controller; local edits survive transport failures. */
export function createCollaboration(
  id: string,
  document: InterviewDocument,
  onStatus: (status: CollaborationStatus) => void,
  onSnapshot?: (snapshot: InterviewSnapshot, result?: Submission) => void,
) {
  const transport = createInterviewSocket(id);
  const reports = createInterviewRuleReporter((kind, key) =>
    transport.request("rule-event", { kind, key }),
  );
  const clientID = crypto.randomUUID();
  let view: EditorView | undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  let rerun = false;
  let retry:
    | {
        key: string;
        body: { epoch: string; version: number; updates: { clientID: string; changes: unknown }[] };
      }
    | undefined;
  let lastStatus: CollaborationStatus | undefined;
  let odyssey: { progress: OdysseyProgress; language: EditorLanguage } | undefined;
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
    if (!view || disposed) return;
    const version = getSyncedVersion(view.state);
    const response = await transport.request<InterviewUpdates>("pull", {
      version,
      epoch: document.epoch,
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
          const response = await transport.request<InterviewUpdates>("push", {
            push: retry.body,
            key: retry.key,
          });
          apply(response);
          retry = undefined;
        } catch (error) {
          if (!(error instanceof InterviewError) || error.code !== "stale_version") throw error;
          retry = undefined;
          await pull();
        }
      } else await pull();
      if (view && odyssey && !retry && !sendableUpdates(view.state).length) {
        const before = view.state.doc.toString();
        const version = getSyncedVersion(view.state);
        const edit = await unlockedMethodEdit(before, odyssey.language, odyssey.progress.levels);
        if (
          edit &&
          before === view.state.doc.toString() &&
          version === getSyncedVersion(view.state)
        ) {
          try {
            // Version-checked server insertion avoids duplicate stubs when peers unlock together.
            await transport.request("push", {
              key: crypto.randomUUID(),
              push: {
                epoch: document.epoch,
                version,
                updates: [
                  {
                    clientID: "odyssey-stubs",
                    changes: ChangeSet.of(edit, before.length).toJSON(),
                  },
                ],
              },
            });
          } catch (error) {
            if (!(error instanceof InterviewError) || error.code !== "stale_version") throw error;
          }
          await pull();
          schedule(0);
        }
      }
      if (!disposed) {
        status("connected");
        if (view && sendableUpdates(view.state).length) schedule(0);
      }
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
  let refreshing = false;
  let refreshAgain = false;
  async function refreshSnapshot() {
    if (!onSnapshot || !view) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      do {
        refreshAgain = false;
        const snapshot = await transport.request<InterviewSnapshot>("snapshot");
        const result = snapshot.latestSubmissionId
          ? await transport.request<Submission>("submission", {
              submissionId: snapshot.latestSubmissionId,
            })
          : undefined;
        if (view) onSnapshot(snapshot, result);
      } while (refreshAgain && view);
    } catch {
      /* Reconnect refreshes the current authorized snapshot. */
    } finally {
      refreshing = false;
    }
  }
  transport.onChange((kind) => {
    if (kind !== "interview.presence") schedule();
    if (kind !== "interview.presence" && kind !== "interview.document") void refreshSnapshot();
  });
  transport.onStatus((connected) => {
    reports.connected(connected);
    if (!disposed) status(connected ? "connecting" : "offline");
  });
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(editor: EditorView) {
        view = editor;
        disposed = false;
        status("connecting");
        reports.start();
        transport.start();
      }
      update(update: ViewUpdate) {
        if (update.docChanged) schedule(40);
      }
      destroy() {
        disposed = true;
        clearTimeout(timer);
        reports.stop();
        transport.stop();
        view = undefined;
      }
    },
  );
  return {
    setOdyssey(progress: OdysseyProgress | undefined, language: EditorLanguage) {
      odyssey = progress ? { progress, language } : undefined;
      if (progress) schedule();
    },
    reportRule: reports.report,
    isSynchronized: () => !!view && !retry && !sendableUpdates(view.state).length,
    extension: [
      collab({ startVersion: document.version, clientID }),
      plugin,
      presenceExtension(transport, document.epoch, clientID),
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
