import type { PublishedQuestion, Workspace } from "@quorem/contracts";
import type { EditorLanguage } from "./editorLanguages";

/** Browser-only document; never sent to workspace or submission APIs. */
export function guestWorkspace(problem: PublishedQuestion, language: EditorLanguage): Workspace {
  return {
    id: `guest:${problem.id}:${language}`,
    kind: "solo",
    problemVersionId: problem.id,
    language,
  };
}
