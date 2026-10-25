/** @file presence.ts @description Advisory remote selections with version-safe positions. @module interviews */
import { getSyncedVersion, sendableUpdates } from "@codemirror/collab";
import { StateEffect } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { InterviewSocket } from "./socket";

export type InterviewPresence = {
  clientID: string;
  userId: string;
  name: string;
  version: number;
  epoch: string;
  anchor: number;
  head: number;
};
const receivedPresence = StateEffect.define<InterviewPresence[]>();

/** Labels cursors using textContent; names never enter HTML. */
class RemoteCursor extends WidgetType {
  constructor(readonly name: string) {
    super();
  }
  eq(other: RemoteCursor) {
    return this.name === other.name;
  }
  toDOM() {
    const cursor = document.createElement("span");
    cursor.className = "interview-remote-cursor";
    cursor.setAttribute("aria-label", `${this.name}'s cursor`);
    const label = document.createElement("span");
    label.textContent = this.name;
    cursor.append(label);
    return cursor;
  }
}

/** @returns Event-driven advisory cursors with expiring leases; presence never decides document authority. */
export function presenceExtension(transport: InterviewSocket, epoch: string, clientID: string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
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
            const peers = await transport.request<InterviewPresence[]>("peers");
            if (!this.disposed) this.view.dispatch({ effects: receivedPresence.of(peers) });
          } while (this.readAgain && !this.disposed);
        } catch {
          /* A reconnect refreshes advisory selections. */
        } finally {
          this.reading = false;
        }
      }
      async publish() {
        if (this.disposed || sendableUpdates(this.view.state).length) return;
        const version = getSyncedVersion(this.view.state);
        const { anchor, head } = this.view.state.selection.main;
        try {
          const peers = await transport.request<InterviewPresence[]>("presence", {
            presence: { clientID, epoch, version, anchor, head },
          });
          if (!this.disposed) this.view.dispatch({ effects: receivedPresence.of(peers) });
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
            const ranges = effect.value
              .filter(
                (peer) =>
                  !sendableUpdates(update.state).length &&
                  peer.clientID !== clientID &&
                  peer.epoch === epoch &&
                  peer.version === version &&
                  peer.anchor >= 0 &&
                  peer.head >= 0 &&
                  peer.anchor <= update.state.doc.length &&
                  peer.head <= update.state.doc.length,
              )
              .flatMap((peer) => [
                ...(peer.anchor !== peer.head
                  ? [
                      Decoration.mark({ class: "interview-remote-selection" }).range(
                        Math.min(peer.anchor, peer.head),
                        Math.max(peer.anchor, peer.head),
                      ),
                    ]
                  : []),
                Decoration.widget({ widget: new RemoteCursor(peer.name), side: 1 }).range(
                  peer.head,
                ),
              ]);
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
