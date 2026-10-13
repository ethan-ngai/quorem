import type { ProblemVersion, Workspace } from "@quorem/contracts";
import type { EditorLanguage } from "./editorLanguages";

/** Browser-only document; never sent to workspace or submission APIs. */
export function guestWorkspace(problem: ProblemVersion, language: EditorLanguage): Workspace {
  return {
    id: `guest:${problem.id}:${language}`,
    kind: "solo",
    problemVersionId: problem.id,
    language,
    preferences: {
      theme: "system",
      paneRatios: [40, 60],
      codeFontSize: 15,
      tabSize: 4,
      wrap: false,
    },
  };
}
