import { sourceFilter } from "../collaboration/sourceFilter";
import { synchronizeMethodStubs } from "../collaboration/methodStubs";
import type { OdysseyProgress } from "@quorem/contracts";
import type { EditorLanguage } from "../editor/editorLanguages";
/** @file collaboration.ts @description Team transport around shared document and cursor primitives. @module factions */
import { randomUUID } from "../../randomUUID";
import {
  createDocumentSync,
  type CollaborationStatus,
  type DocumentUpdates,
} from "../collaboration/documentSync";
import { presenceExtension } from "../collaboration/presence";
import type { TeamSnapshot, TeamPeer } from "@quorem/contracts/factions";
import { teamRequest, TeamError } from "./api";
export function createTeamCollaboration(
  id: string,
  initial: TeamSnapshot,
  onStatus: (status: CollaborationStatus) => void,
) {
  const clientID = randomUUID();
  const listeners = new Set<(kind?: string) => void>();
  const statuses = new Set<(connected: boolean) => void>();
  let odyssey: { progress: OdysseyProgress; language: EditorLanguage } | undefined;
  let peers: TeamPeer[] = initial.peers;
  let timer: ReturnType<typeof setInterval> | undefined;
  const sync = createDocumentSync({
    document: initial.document,
    clientID,
    onStatus(status) {
      onStatus(status);
      for (const listener of statuses) listener(status === "connected");
    },
    async onSynchronized(document) {
      if (odyssey)
        await synchronizeMethodStubs(
          document,
          initial.document.epoch,
          odyssey.progress,
          odyssey.language,
          (body, key) => teamRequest(id, "push", body, key),
          (error) => error instanceof TeamError && error.code === "stale_version",
        );
    },
    pull: (position) => teamRequest<DocumentUpdates>(id, "pull", position),
    push: (push, key) => teamRequest<DocumentUpdates>(id, "push", push, key),
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
      sync.schedule();
      timer = setInterval(() => sync.schedule(), 750);
    },
    onDestroy() {
      clearInterval(timer);
    },
  });
  const transport = {
    async request<T>(type: string, body?: Record<string, unknown>): Promise<T> {
      if (type === "peers") return peers as T;
      return teamRequest<T>(id, "presence", body?.presence);
    },
    onChange(listener: (kind?: string) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onStatus(listener: (connected: boolean) => void) {
      statuses.add(listener);
      return () => {
        statuses.delete(listener);
      };
    },
  };
  return {
    ...sync,
    updateOdyssey(this: void, progress: OdysseyProgress, language: EditorLanguage) {
      odyssey = { progress, language };
      sync.schedule();
    },
    extension: [
      sourceFilter,
      sync.extension,
      presenceExtension(transport, initial.document.epoch, clientID),
    ],
    update(snapshot: TeamSnapshot) {
      peers = snapshot.peers;
      for (const listener of listeners) listener();
      sync.schedule();
    },
  };
}
