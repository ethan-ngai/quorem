import { sourceFilter } from "../collaboration/sourceFilter";
import { synchronizeMethodStubs } from "../collaboration/methodStubs";
import type { OdysseyProgress } from "@quorem/contracts";
import type { EditorLanguage } from "../editor/editorLanguages";
/** @file collaboration.ts @description Team transport around shared document and cursor primitives. @module factions */
import { randomUUID } from "../../randomUUID";
import { createDocumentSync, type CollaborationStatus } from "../collaboration/documentSync";
import { createCommandSocket } from "../realtime/commandSocket";
import { presenceExtension } from "../collaboration/presence";
import type { TeamSnapshot } from "@quorem/contracts/factions";
import { TeamError } from "./api";
export function createTeamCollaboration(
  id: string,
  initial: TeamSnapshot,
  onStatus: (status: CollaborationStatus) => void,
  refreshSnapshot: () => void,
) {
  const clientID = randomUUID();
  const transport = createCommandSocket({
    path: `/v1/matches/${encodeURIComponent(id)}/team/${initial.team}/events`,
    label: "Faction",
    error: (code, _status, message) => new TeamError(code, message),
  });
  let odyssey: { progress: OdysseyProgress; language: EditorLanguage } | undefined;
  let connected = false;
  const sync = createDocumentSync({
    document: initial.document,
    clientID,
    onStatus,
    async onSynchronized(document) {
      if (odyssey)
        await synchronizeMethodStubs(
          document,
          initial.document.epoch,
          odyssey.progress,
          odyssey.language,
          (push, key) => transport.request("push", { push, key }),
          (error) => error instanceof TeamError && error.code === "stale_version",
        );
    },
    pull: (position) => transport.request("pull", position),
    push: (push, key) => transport.request("push", { push, key }),
    classifyError: (error) =>
      error instanceof TeamError
        ? error.code === "stale_version"
          ? "stale"
          : error.code === "document_changed"
            ? "replaced"
            : error.code === "invalid_transition" || error.code === "not_found"
              ? "offline"
              : "retry"
        : "retry",
    onMount() {
      sync.connectionChanged(connected);
    },
  });
  function connectionChanged(next: boolean) {
    connected = next;
    sync.connectionChanged(next);
  }
  transport.onStatus(connectionChanged);
  transport.onChange((kind) => {
    if (!kind || kind === "team.document") sync.schedule();
    if (!kind || kind === "team.snapshot") refreshSnapshot();
  });
  const cursors = {
    ...transport,
    onChange(listener: (kind?: string) => void) {
      return transport.onChange((kind) => {
        if (!kind || kind === "team.presence") listener(kind);
      });
    },
  };
  return {
    ...sync,
    start: transport.start,
    stop() {
      transport.stop();
      connectionChanged(false);
    },
    updateOdyssey(this: void, progress: OdysseyProgress, language: EditorLanguage) {
      odyssey = { progress, language };
      sync.schedule();
    },
    extension: [
      sourceFilter,
      sync.extension,
      presenceExtension(cursors, initial.document.epoch, clientID),
    ],
  };
}
