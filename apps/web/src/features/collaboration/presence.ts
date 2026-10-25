/** @file presence.ts @description Transport-neutral remote selections with version-safe positions. @module collaboration */
import { getSyncedVersion, sendableUpdates } from "@codemirror/collab";
import { StateEffect } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { participantColor } from "./participantColor";
import { RemoteCursor, CURSOR_LABEL_DELAY, type CursorLabel } from "./remoteCursor";
import "./presence.css";

export type PresenceTransport = {
  request<T>(type: string, body?: Record<string, unknown>): Promise<T>;
  onChange(listener: (kind?: string) => void): () => void;
  onStatus(listener: (connected: boolean) => void): () => void;
};

export type CollaborationPresence = {
  clientID: string;
  userId: string;
  name: string;
  version: number;
  epoch: string;
  anchor: number;
  head: number;
};
const receivedPresence = StateEffect.define<CollaborationPresence[]>();

/** @returns Event-driven advisory cursors with expiring leases; presence never decides document authority. */
export function presenceExtension(
  transport: PresenceTransport,
  epoch: string,
  clientID: string,
  onPeers?: (peers: CollaborationPresence[]) => void,
  onDisconnect?: () => void,
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      labels = new Map<string, CursorLabel>();
      timer: ReturnType<typeof setTimeout> | undefined;
      heartbeat: ReturnType<typeof setInterval>;
      disposed = false;
      reading = false;
      readAgain = false;
      stop: () => void;
      stopStatus: () => void;
      constructor(readonly view: EditorView) {
        this.stop = transport.onChange(() => {
          void this.read();
        });
        this.heartbeat = setInterval(() => {
          void this.publish();
        }, 10_000);
        this.stopStatus = transport.onStatus((connected) => {
          if (!connected) onDisconnect?.();
          if (connected && !this.disposed) this.schedule();
        });
      }
      schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          void this.publish();
        }, 60);
      }
      async read() {
        if (this.disposed) return;
        if (this.reading) {
          this.readAgain = true;
          return;
        }
        this.reading = true;
        try {
          do {
            this.readAgain = false;
            const peers = await transport.request<CollaborationPresence[]>("peers");
            if (!this.disposed) this.receive(peers);
          } while (this.readAgain && !this.disposed);
        } catch {
          /* A reconnect refreshes advisory selections. */
        } finally {
          this.reading = false;
        }
      }
      receive(peers: CollaborationPresence[]) {
        onPeers?.(peers);
        const active = new Set(peers.map((peer) => peer.clientID));
        for (const id of this.labels.keys()) if (!active.has(id)) this.labels.delete(id);
        this.view.dispatch({ effects: receivedPresence.of(peers) });
      }
      async publish() {
        if (this.disposed || sendableUpdates(this.view.state).length) return;
        const version = getSyncedVersion(this.view.state);
        const { anchor, head } = this.view.state.selection.main;
        try {
          const peers = await transport.request<CollaborationPresence[]>("presence", {
            presence: { clientID, epoch, version, anchor, head },
          });
          if (!this.disposed) this.receive(peers);
        } catch {
          /* Presence never blocks document synchronization. */
        }
      }
      update(update: ViewUpdate) {
        if (update.docChanged) this.decorations = Decoration.none;
        if (
          update.docChanged ||
          update.selectionSet ||
          getSyncedVersion(update.startState) !== getSyncedVersion(update.state)
        )
          this.schedule();
        for (const transaction of update.transactions)
          for (const effect of transaction.effects) {
            if (!effect.is(receivedPresence)) continue;
            const version = getSyncedVersion(update.state);
            const selfId = effect.value.find((self) => self.clientID === clientID)?.userId;
            const pending = sendableUpdates(update.state).length > 0;
            const ranges = effect.value
              .filter(
                (peer) =>
                  !pending &&
                  peer.clientID !== clientID &&
                  peer.userId !== selfId &&
                  peer.epoch === epoch &&
                  peer.version === version &&
                  peer.anchor >= 0 &&
                  peer.head >= 0 &&
                  peer.anchor <= update.state.doc.length &&
                  peer.head <= update.state.doc.length,
              )
              .flatMap((peer) => {
                let label = this.labels.get(peer.clientID);
                if (!label) {
                  label = { visibleUntil: Date.now() + CURSOR_LABEL_DELAY };
                  this.labels.set(peer.clientID, label);
                }
                const color = participantColor(peer.userId);
                return [
                  ...(peer.anchor !== peer.head
                    ? [
                        Decoration.mark({
                          class: "collaboration-remote-selection",
                          attributes: { style: `--participant-color: ${color}` },
                        }).range(
                          Math.min(peer.anchor, peer.head),
                          Math.max(peer.anchor, peer.head),
                        ),
                      ]
                    : []),
                  Decoration.widget({
                    widget: new RemoteCursor(peer.name, color, label),
                    side: 1,
                  }).range(peer.head),
                ];
              });
            this.decorations = Decoration.set(ranges, true);
          }
      }
      destroy() {
        this.disposed = true;
        clearTimeout(this.timer);
        clearInterval(this.heartbeat);
        this.stop();
        this.stopStatus();
      }
    },
    { decorations: (value) => value.decorations },
  );
}
