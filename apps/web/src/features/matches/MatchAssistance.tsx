/** @file MatchAssistance.tsx @description Assistance reveals and confirmation of their effects. @module matches */
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DevelopmentIdentity, MatchSnapshot, Submission } from "@quorem/contracts";
import type {
  RuleActionRequest,
  RuleActionResult,
  RuleActionQuote,
} from "@quorem/contracts/match-rules";
import { matchRuleAction } from "./api";
import { SessionDialog } from "../../ui/SessionDialog";
import { NoticeRegion } from "../../ui/PersistentNotice";
import { ownParticipant } from "./matchState";
import "./match-rules.css";
export const ruleCostLabel = (cost: { seconds: number; points: number }) =>
  cost.seconds ? `+${cost.seconds}s` : cost.points ? `−${cost.points} points` : "No penalty";
type OnReveal = (value: NonNullable<RuleActionResult["revealed"]>) => void;

export type MatchDisclosureControls = {
  disabled: boolean;
  reveal: (kind: "topics" | "complexity", onReveal: OnReveal) => void;
};

export function MatchAssistance({
  match,
  identity,
  submission,
  children,
  onPaidAction,
}: {
  match: MatchSnapshot;
  identity: DevelopmentIdentity;
  submission?: Submission;
  children?: (controls: MatchDisclosureControls) => ReactNode;
  onPaidAction?: (input: RuleActionRequest) => Promise<void>;
}) {
  const client = useQueryClient();
  const own = ownParticipant(match, identity);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    input: RuleActionRequest;
    quote: RuleActionQuote;
    onReveal?: OnReveal;
  }>();
  const [selectedCase, setSelectedCase] = useState(1);
  const [revealedCase, setRevealedCase] = useState<number>();
  const [revealed, setRevealed] = useState<RuleActionResult["revealed"]>();
  const disabled = pending || match.state !== "active" || !!own?.forfeited;
  const perform = async (input: RuleActionRequest, onReveal?: OnReveal) => {
    if (disabled) return;
    setPending(true);
    setError("");
    try {
      const result = await matchRuleAction(identity, match.id, input);
      const selectedInput = {
        ...input,
        ...(result.quote.caseIndex !== undefined ? { caseIndex: result.quote.caseIndex } : {}),
      };
      const penalized = result.quote.seconds > 0 || result.quote.points > 0;
      const announced =
        input.kind !== "submission" &&
        !result.quote.alreadyRevealed &&
        match.rules.assistance[input.kind].access !== "free";
      if (!input.approval && (penalized || announced)) {
        if (penalized && onPaidAction) await onPaidAction(selectedInput);
        else setConfirmation({ input: selectedInput, quote: result.quote, onReveal });
      } else {
        const opened = input.approval
          ? result
          : await matchRuleAction(identity, match.id, {
              ...selectedInput,
              approval: result.quote,
            });
        if (opened.revealed) {
          if (onReveal) onReveal(opened.revealed);
          else {
            setRevealed(opened.revealed);
            setRevealedCase(opened.quote.caseIndex);
          }
        }
        setConfirmation(undefined);
      }
      await client.invalidateQueries({ queryKey: ["match", identity, match.id] });
      await client.invalidateQueries({
        predicate: (q) => q.queryKey.includes(match.problemVersionId),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reveal assistance.");
    } finally {
      setPending(false);
    }
  };
  const hiddenCount =
    submission?.kind === "submit" && submission.state === "completed"
      ? (submission.score?.total ?? 0)
      : 0;
  const caseNumber = Math.min(selectedCase, hiddenCount);
  const canRevealCase = match.rules.assistance.hiddenCase.access !== "blocked" && hiddenCount > 0;
  return (
    <>
      {(canRevealCase || error || revealed?.input) && (
        <section className="match-assistance" aria-label="Match assistance">
          {canRevealCase && (
            <div className="match-hidden-case-action">
              <label>
                Hidden case
                <input
                  type="number"
                  min={1}
                  max={hiddenCount}
                  step={1}
                  aria-label="Hidden case number"
                  value={caseNumber}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isInteger(next) && next >= 1 && next <= hiddenCount)
                      setSelectedCase(next);
                  }}
                />
                <span>of {hiddenCount}</span>
              </label>
              <button
                className="quiet-button"
                disabled={disabled}
                onClick={() =>
                  void perform({
                    kind: "hiddenCase",
                    submissionId: submission!.id,
                    caseIndex: caseNumber - 1,
                  })
                }
              >
                Reveal case
              </button>
            </div>
          )}
          <NoticeRegion message={error} label="Assistance unavailable">
            {null}
          </NoticeRegion>
          {revealed?.input && (
            <details open>
              <summary>Hidden case {revealedCase === undefined ? "" : revealedCase + 1}</summary>
              <strong>Input and expected output</strong>
              <pre>{revealed.input}</pre>
              <strong>Your result</strong>
              <pre>{revealed.result}</pre>
            </details>
          )}
        </section>
      )}
      {children?.({ disabled, reveal: (kind, onReveal) => void perform({ kind }, onReveal) })}
      <SessionDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(undefined);
        }}
        pending={pending}
        title={
          confirmation?.input.kind === "hiddenCase"
            ? `Reveal hidden case ${(confirmation.input.caseIndex ?? 0) + 1}?`
            : confirmation?.input.kind === "topics"
              ? "Reveal topics?"
              : "Reveal complexity?"
        }
        description={`${confirmation ? ruleCostLabel(confirmation.quote) : ""}. Players will be notified of the reveal.`}
      >
        <div className="competitive-dialog-actions">
          <button
            className="button button-secondary"
            disabled={pending}
            onClick={() => setConfirmation(undefined)}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={pending}
            onClick={() =>
              confirmation &&
              void perform(
                { ...confirmation.input, approval: confirmation.quote },
                confirmation.onReveal,
              )
            }
          >
            Reveal
          </button>
        </div>
      </SessionDialog>
    </>
  );
}
