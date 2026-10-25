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
import { interviewRequest } from "./api";

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

/** @returns Bounded advisory cursor polling; presence never decides document authority. */
export function presenceExtension(id: string, epoch: string, clientID: string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      timer: ReturnType<typeof setTimeout> | undefined;
      disposed = false;
      constructor(readonly view: EditorView) {
        this.schedule(0);
      }
      schedule(delay = 1200) {
        this.timer = setTimeout(() => {
          void this.poll().finally(() => {
            if (!this.disposed) this.schedule();
          });
        }, delay);
      }
      async poll() {
        if (this.disposed || sendableUpdates(this.view.state).length) return;
        const version = getSyncedVersion(this.view.state);
        const { anchor, head } = this.view.state.selection.main;
        try {
          await interviewRequest(`/v1/interviews/${id}/presence`, "POST", {
            clientID,
            epoch,
            version,
            anchor,
            head,
          });
          const peers = await interviewRequest<InterviewPresence[]>(
            `/v1/interviews/${id}/presence`,
          );
          if (
            !this.disposed &&
            version === getSyncedVersion(this.view.state) &&
            !sendableUpdates(this.view.state).length
          )
            this.view.dispatch({ effects: receivedPresence.of(peers) });
        } catch {
          /* Presence is advisory; editing and reconnect remain independent. */
        }
      }
      update(update: ViewUpdate) {
        if (update.docChanged) this.decorations = Decoration.none;
        for (const transaction of update.transactions)
          for (const effect of transaction.effects) {
            if (!effect.is(receivedPresence)) continue;
            const version = getSyncedVersion(update.state);
            const ranges = effect.value
              .filter(
                (peer) =>
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
      }
    },
    { decorations: (value) => value.decorations },
  );
}
