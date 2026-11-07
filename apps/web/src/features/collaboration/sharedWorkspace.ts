import type { OdysseyProgress } from "@quorem/contracts";
import type { RuleActionRequest } from "@quorem/contracts/match-rules";
/** @file sharedWorkspace.ts @description Collaboration policy injected into the shared editor workspace. @module collaboration */
import type { Extension } from "@codemirror/state";
import type { EditorLanguage } from "../editor/editorLanguages";
export type SharedWorkspaceDocument = {
  updateOdyssey(this: void, progress: OdysseyProgress, language: EditorLanguage): void;
  source: string;
  extension: Extension;
  latestSubmissionId?: string;
  beforeExecution(this: void, kind: "run" | "submit"): Promise<boolean>;
  requestPaidAction(this: void, action: RuleActionRequest): Promise<void>;
  changeLanguage(this: void, language: EditorLanguage): Promise<void>;
};
