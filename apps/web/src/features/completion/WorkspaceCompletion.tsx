/** @file WorkspaceCompletion.tsx @description Celebrate accepted Submit results once, after Odyssey progress settles. @module completion */
import { useState } from "react";
import type { OdysseyProgress, Submission, PublishedQuestion } from "@quorem/contracts";
import type { CompletionOutcome } from "../../ui/completionOutcome";
import { useCompletionEvent } from "./useCompletionEvent";
import { Celebration } from "../../ui/Celebration";
import { DifficultyLabel } from "../../ui/DifficultyLabel";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { languageLabels, type EditorLanguage } from "../editor/editorLanguages";
import { CompletionDialog } from "./CompletionDialog";

export function WorkspaceCompletion({
  submission,
  workspaceId,
  title,
  difficulty,
  language,
  odyssey,
  odysseyReady = true,
  competitive = false,
  outcome,
}: {
  submission?: Submission;
  workspaceId: string;
  title: string;
  difficulty: PublishedQuestion["difficulty"];
  language: EditorLanguage;
  odyssey?: OdysseyProgress;
  odysseyReady?: boolean;
  competitive?: boolean;
  outcome: CompletionOutcome;
}) {
  const [event, setEvent] = useState<{ id: string; finale: boolean }>();
  const [open, setOpen] = useState(false);
  useCompletionEvent({
    scope: workspaceId,
    submission,
    enabled: submission?.workspaceId === workspaceId && odysseyReady && (!competitive || !!odyssey),
    onAccepted: ({ id }) => {
      const finale = !competitive && (!odyssey || odyssey.completed);
      setEvent({ id, finale });
      setOpen(finale);
    },
  });
  if (!event) return null;
  if (!event.finale) return <Celebration key={event.id} outcome={outcome} inline />;
  return (
    <CompletionDialog
      key={event.id}
      outcome={outcome}
      open={open}
      onOpenChange={setOpen}
      title={odyssey ? "Odyssey complete" : "Problem solved"}
      description={
        odyssey ? "Every level cleared. Nicely done." : "Your solution passed every test case."
      }
      descriptionHidden
      context={
        <div className="completion-problem">
          <span>{title}</span>
          <DifficultyLabel difficulty={difficulty} />
        </div>
      }
      stats={[
        ...(odyssey
          ? [
              {
                label: "Levels cleared",
                value: String(odyssey.totalLevels ?? odyssey.levels.length),
                numeric: true,
              },
            ]
          : []),
        ...(submission?.score
          ? [
              {
                label: "Cases passed",
                value: `${submission.score.passed} / ${submission.score.total}`,
                numeric: true,
              },
            ]
          : []),
        {
          label: "Language",
          value: <LanguageLogo language={language} tooltip={languageLabels[language]} />,
          hideLabel: true,
        },
      ]}
      actions={
        <>
          <a className="quiet-button" href="/practice">
            More problems
          </a>
          <button className="button button-primary" onClick={() => setOpen(false)}>
            Back to editor
          </button>
        </>
      }
    />
  );
}
