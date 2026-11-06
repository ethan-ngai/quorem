import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, MatchReview, ProblemVersion } from "@quorem/contracts";
import { PythonEditor, type EditorTheme, type PythonEditorHandle } from "../editor/PythonEditor";
import { useWorkspaceDraft } from "../editor/useWorkspaceDraft";
import { readBrowserDraft } from "../editor/recovery";
import { languageFileNames, type EditorLanguage } from "../editor/editorLanguages";
import type { EditorScheme } from "../editor/editorSchemes";
import { ReviewPaneHeader } from "./ReviewToolbar";
import { createReviewWorkspace } from "./useMatchReview";

export function ReviewComparison({
  identity,
  matchId,
  participant,
  problem,
  theme,
  colorScheme,
  fontSize,
  tabSize,
  wrap,
  hidden,
  onSource,
  onSelect,
  disabled,
}: {
  identity: DevelopmentIdentity;
  matchId: string;
  participant: MatchReview["participants"][number];
  problem: ProblemVersion;
  theme: EditorTheme;
  colorScheme: EditorScheme;
  fontSize: number;
  tabSize: 2 | 4;
  wrap: boolean;
  hidden: boolean;
  onSource: (value: { participantId: string; language: EditorLanguage; source: string }) => void;
  onSelect: () => void;
  disabled: boolean;
}) {
  const language = (
    participant.own ? participant.workspace?.language : participant.submission?.language
  ) as EditorLanguage | undefined;
  const selectedLanguage = problem.languages?.some((item) => item.language === language)
    ? language!
    : (problem.languages?.[0]?.language ?? "python");
  const workspace = useQuery({
    queryKey: ["workspace", identity, matchId, participant.userId, selectedLanguage],
    queryFn: () => createReviewWorkspace(matchId, participant.userId, selectedLanguage),
  });
  const editorRef = useRef<PythonEditorHandle>(null);
  const [saveError, setSaveError] = useState(false);
  const initialSource =
    participant.own && participant.workspace?.language === selectedLanguage
      ? (readBrowserDraft(identity, participant.workspace.id, problem.id) ??
        participant.submission?.source)
      : participant.submission?.language === selectedLanguage
        ? participant.submission.source
        : undefined;
  const draft = useWorkspaceDraft({
    identity,
    accountPresent: true,
    queriedProblem: problem,
    loadedWorkspace: workspace.data,
    editorRef,
    initialSource,
    onError: () => setSaveError(true),
  });
  const current = draft.workspace?.id === workspace.data?.id;
  useEffect(() => {
    if (current && draft.workspace)
      onSource({
        participantId: participant.userId,
        language: selectedLanguage,
        source: draft.sourceRef.current,
      });
  }, [current, draft.workspace, participant.userId, selectedLanguage, onSource]);
  return (
    <div className="review-reference" hidden={hidden}>
      <ReviewPaneHeader
        participant={participant}
        name={participant.displayName}
        self={participant.own}
        language={selectedLanguage}
        disabled={disabled}
        onSelect={() =>
          void draft
            .saveBeforeSwitch()
            .then(onSelect)
            .catch(() => setSaveError(true))
        }
      />
      {saveError && <p role="alert">Could not save this comparison draft.</p>}
      {workspace.isError ? (
        <p role="alert">Could not open comparison draft.</p>
      ) : current && draft.workspace ? (
        <PythonEditor
          ref={editorRef}
          documentKey={`${identity}:${draft.workspace.id}:${problem.id}:${selectedLanguage}`}
          documentUri={`file:///workspace/${languageFileNames[selectedLanguage]}`}
          initialSource={draft.source}
          language={selectedLanguage}
          theme={theme}
          colorScheme={colorScheme}
          fontSize={fontSize}
          tabSize={tabSize}
          wrap={wrap}
          readOnly
          onSourceChange={(source) => {
            draft.updateSource(source);
            onSource({ participantId: participant.userId, language: selectedLanguage, source });
          }}
        />
      ) : (
        <p role="status">Loading comparison…</p>
      )}
    </div>
  );
}
