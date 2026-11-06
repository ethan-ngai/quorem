/** @file methodStubs.ts @description Version-fenced method insertion for shared editors. @module collaboration */
import { getSyncedVersion } from "@codemirror/collab";
import { ChangeSet } from "@codemirror/state";
import type { OdysseyProgress } from "@quorem/contracts";
import type { EditorLanguage } from "../editor/editorLanguages";
import { unlockedMethodEdit } from "../odyssey/methodStubs";
import { randomUUID } from "../../randomUUID";
import type { DocumentPush, SynchronizedDocument } from "./documentSync";
export async function synchronizeMethodStubs(
  { view, pull, schedule }: SynchronizedDocument,
  epoch: string,
  progress: OdysseyProgress,
  language: EditorLanguage,
  push: (body: DocumentPush, key: string) => Promise<unknown>,
  stale: (error: unknown) => boolean,
) {
  const before = view.state.doc.toString(),
    version = getSyncedVersion(view.state);
  const edit = await unlockedMethodEdit(before, language, progress.levels);
  if (!edit || before !== view.state.doc.toString() || version !== getSyncedVersion(view.state))
    return;
  try {
    await push(
      {
        epoch,
        version,
        updates: [
          { clientID: "odyssey-stubs", changes: ChangeSet.of(edit, before.length).toJSON() },
        ],
      },
      randomUUID(),
    );
  } catch (error) {
    if (!stale(error)) throw error;
  }
  await pull();
  schedule(0);
}
