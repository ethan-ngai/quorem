/** @file editorStateCache.ts @description Bounded serialized undo and selection snapshots with fresh language extensions. @module editor */
import { historyField } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";

/** Stores JSON only: language/LSP extensions are always rebuilt for the current document. */
export class EditorStateCache {
  private readonly snapshots = new Map<string, ReturnType<EditorState["toJSON"]>>();

  constructor(private readonly limit = 12) {}

  save(documentKey: string, state: EditorState) {
    this.snapshots.delete(documentKey);
    this.snapshots.set(documentKey, state.toJSON({ history: historyField }));
    while (this.snapshots.size > this.limit)
      this.snapshots.delete(this.snapshots.keys().next().value!);
  }

  restore(documentKey: string, source: string, extensions: Extension) {
    const snapshot = this.snapshots.get(documentKey);
    this.snapshots.delete(documentKey);
    // A recovery/import/reset may replace source while this document is unmounted.
    if (snapshot?.doc === source)
      return EditorState.fromJSON(snapshot, { extensions }, { history: historyField });
    return EditorState.create({ doc: source, extensions });
  }
}

export const editorStateCache = new EditorStateCache();
