/** @file collaboration.ts @description Interview policy around shared document synchronization. @module interviews */
import { randomUUID } from "../../randomUUID";
import { synchronizeMethodStubs } from "../collaboration/methodStubs";
import type {
  OdysseyProgress,
  InterviewDocument,
  InterviewSnapshot,
  Submission,
} from "@quorem/contracts";
import type { EditorLanguage } from "../editor/editorLanguages";
import { createInterviewRuleReporter } from "./ruleEvents";
import { type Extension } from "@codemirror/state";
import { sourceFilter } from "../collaboration/sourceFilter";
import type { EditorView } from "@codemirror/view";
import { createDocumentSync, type CollaborationStatus } from "../collaboration/documentSync";
import { createInterviewSocket } from "./socket";
import { presenceExtension } from "./presence";
import { InterviewError, interviewRequest } from "./api";

export type { CollaborationStatus } from "../collaboration/documentSync";

/** @returns Interview collaboration with local edits retained across transport failures. */
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
  const clientID = randomUUID();
  let view: EditorView | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshGeneration = 0;
  let refreshAbort: AbortController | undefined;
  let odyssey: { progress: OdysseyProgress; language: EditorLanguage } | undefined;
  const sync = createDocumentSync({
    document,
    clientID,
    onStatus,
    pull: (position) => transport.request("pull", position),
    push: (push, key) => transport.request("push", { push, key }),
    classifyError(error) {
      if (error instanceof InterviewError) {
        if (error.code === "stale_version") return "stale";
        if (["document_changed", "document_replaced", "stale_epoch"].includes(error.code))
          return "replaced";
        return error.code === "temporarily_unavailable" ? "retry" : "offline";
      }
      return "retry";
    },
    onMount(editor) {
      view = editor;
      reports.start();
      transport.start();
    },
    onDestroy() {
      view = undefined;
      refreshGeneration++;
      refreshAbort?.abort();
      clearTimeout(refreshTimer);
      reports.stop();
      transport.stop();
    },
    async onSynchronized(documentState) {
      if (odyssey)
        await synchronizeMethodStubs(
          documentState,
          document.epoch,
          odyssey.progress,
          odyssey.language,
          (push, key) => transport.request("push", { push, key }),
          (error) => error instanceof InterviewError && error.code === "stale_version",
        );
    },
  });
  let refreshing = false;
  let refreshAgain = false;
  async function refreshSnapshot() {
    if (!onSnapshot || !view) return;
    clearTimeout(refreshTimer);
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      do {
        refreshAgain = false;
        const generation = refreshGeneration;
        const controller = new AbortController();
        refreshAbort = controller;
        const snapshot = await interviewRequest<InterviewSnapshot>(
          `/v1/interviews/${encodeURIComponent(id)}`,
          "GET",
          undefined,
          undefined,
          controller.signal,
        );
        if (!view || generation !== refreshGeneration) {
          refreshAgain = !!view;
          continue;
        }
        onSnapshot(snapshot);
        const result = snapshot.latestSubmissionId
          ? await interviewRequest<Submission>(
              `/v1/interviews/${encodeURIComponent(id)}/submissions/${encodeURIComponent(snapshot.latestSubmissionId)}`,
              "GET",
              undefined,
              undefined,
              controller.signal,
            )
          : undefined;
        if (view && result && generation === refreshGeneration) onSnapshot(snapshot, result);
      } while (refreshAgain && view);
    } catch {
      if (view) refreshTimer = setTimeout(() => void refreshSnapshot(), 1000);
    } finally {
      refreshing = false;
    }
  }
  transport.onChange((kind) => {
    if (kind !== "interview.presence") sync.schedule();
    if (kind !== "interview.presence" && kind !== "interview.document") {
      refreshGeneration++;
      void refreshSnapshot();
    }
  });
  transport.onStatus((connected) => {
    reports.connected(connected);
    sync.connectionChanged(connected);
  });
  return {
    setOdyssey(progress: OdysseyProgress | undefined, language: EditorLanguage) {
      odyssey = progress ? { progress, language } : undefined;
      if (progress) sync.schedule();
    },
    reportRule: reports.report,
    isSynchronized: sync.isSynchronized,
    extension: [
      [sync.extension[0]!, sourceFilter],
      ...sync.extension.slice(1),
      presenceExtension(transport, document.epoch, clientID),
    ] as Extension,
    flush: sync.flush,
  };
}
