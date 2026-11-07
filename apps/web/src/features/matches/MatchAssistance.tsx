/** @file MatchAssistance.tsx @description Assistance reveals and confirmation of their effects. @module matches */
import { useId, useRef, useState, type ReactNode } from "react";
import { Bell, Clock3, Trophy } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { DevelopmentIdentity, MatchSnapshot, Submission } from "@quorem/contracts";
import type {
  RuleActionRequest,
  RuleActionResult,
  RuleActionQuote,
} from "@quorem/contracts/match-rules";
import { matchRuleAction } from "./api";
import * as Popover from "../../ui/Popover";
import { NoticeRegion } from "../../ui/PersistentNotice";
import { ownParticipant } from "./matchState";
import "./match-rules.css";
export const ruleCostLabel = (cost: { seconds: number; points: number }) =>
  cost.seconds ? `+${cost.seconds}s` : cost.points ? `−${cost.points} points` : "No penalty";
type OnReveal = (value: NonNullable<RuleActionResult["revealed"]>) => void;

export type MatchDisclosureControls = {
  disabled: boolean;
  reveal: (kind: "topics" | "complexity", anchor: HTMLButtonElement, onReveal: OnReveal) => void;
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
  const anchor = useRef<HTMLButtonElement>(null);
  const interactedOutside = useRef(false);
  const confirmationId = useId();
  const [selectedCase, setSelectedCase] = useState(1);
  const [revealedCase, setRevealedCase] = useState<number>();
  const [revealed, setRevealed] = useState<RuleActionResult["revealed"]>();
  const disabled = pending || match.state !== "active" || !!own?.forfeited;
  const confirmationOpen = !!confirmation && match.state === "active" && !own?.forfeited;
  function closeConfirmation() {
    setConfirmation(undefined);
    setError("");
  }
  const perform = async (
    input: RuleActionRequest,
    trigger: HTMLButtonElement,
    onReveal?: OnReveal,
  ) => {
    if (disabled) return;
    if (!input.approval && confirmationOpen && trigger === anchor.current) {
      closeConfirmation();
      return;
    }
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
        else if (trigger.isConnected && trigger.getClientRects().length) {
          anchor.current = trigger;
          interactedOutside.current = false;
          setConfirmation({ input: selectedInput, quote: result.quote, onReveal });
        }
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
        closeConfirmation();
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
  const target =
    confirmation?.input.kind === "hiddenCase"
      ? `hidden case ${(confirmation.input.caseIndex ?? 0) + 1}`
      : confirmation?.input.kind === "topics"
        ? "topics"
        : "complexity";
  const cost = confirmation?.quote;
  const penalty = !!(cost?.seconds || cost?.points);
  const CostIcon = cost?.seconds ? Clock3 : cost?.points ? Trophy : Bell;
  return (
    <>
      {(canRevealCase || (error && !confirmationOpen) || revealed?.input) && (
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
                aria-disabled={disabled}
                aria-haspopup="dialog"
                onClick={(event) =>
                  void perform(
                    {
                      kind: "hiddenCase",
                      submissionId: submission!.id,
                      caseIndex: caseNumber - 1,
                    },
                    event.currentTarget,
                  )
                }
              >
                Reveal case
              </button>
            </div>
          )}
          <NoticeRegion message={confirmationOpen ? "" : error} label="Assistance unavailable">
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
      {children?.({
        disabled,
        reveal: (kind, trigger, onReveal) => void perform({ kind }, trigger, onReveal),
      })}
      <Popover.Root
        open={confirmationOpen}
        onOpenChange={(open) => {
          if (!open && !pending) closeConfirmation();
        }}
      >
        <Popover.Anchor virtualRef={anchor} />
        {/* Restore focus immediately on dismissal during play. */}
        {confirmationOpen && (
          <Popover.Portal>
            <Popover.Content
              className="assistance-confirmation"
              aria-labelledby={confirmationId}
              aria-describedby={`${confirmationId}-cost ${confirmationId}-notice`}
              align="start"
              hideWhenDetached
              onEscapeKeyDown={(event) => {
                if (pending) event.preventDefault();
              }}
              onInteractOutside={(event) => {
                if (
                  pending ||
                  (event.target instanceof Node && anchor.current?.contains(event.target))
                ) {
                  event.preventDefault();
                } else interactedOutside.current = true;
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (!interactedOutside.current) anchor.current?.focus({ preventScroll: true });
              }}
            >
              <h2 id={confirmationId}>Reveal {target}?</h2>
              {cost && (
                <div
                  id={`${confirmationId}-cost`}
                  className="assistance-confirmation-cost"
                  data-penalty={penalty}
                >
                  <CostIcon size={16} aria-hidden="true" />
                  <span>
                    {cost.seconds
                      ? "Added to finish time"
                      : cost.points
                        ? "Deducted from score"
                        : "Reveal cost"}
                  </span>
                  <strong>{ruleCostLabel(cost)}</strong>
                </div>
              )}
              <p id={`${confirmationId}-notice`}>Other players will be notified.</p>
              {error && <p role="alert">{error}</p>}
              <div className="assistance-confirmation-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={pending}
                  onClick={closeConfirmation}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={disabled}
                  onClick={() =>
                    confirmation &&
                    anchor.current &&
                    void perform(
                      { ...confirmation.input, approval: confirmation.quote },
                      anchor.current,
                      confirmation.onReveal,
                    )
                  }
                >
                  Reveal {target}
                </button>
              </div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </Popover.Root>
    </>
  );
}
