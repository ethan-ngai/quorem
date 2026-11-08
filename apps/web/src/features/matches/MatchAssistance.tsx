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
import { useErrorNotification } from "../../ui/Notifications";
import { Icon } from "../../ui/Icon";
import { Spinner } from "../../ui/Spinner";
import type { HiddenCaseDetails } from "../editor/components/TestCases";
import { Tooltip } from "../../ui/Tooltip";
import { ownParticipant } from "./matchState";
import "./match-rules.css";
export const ruleCostLabel = (cost: { seconds: number; points: number }) =>
  cost.seconds ? `+${cost.seconds}s` : cost.points ? `−${cost.points} points` : "No penalty";
const revealNotice = "Other players will be notified.";
type OnReveal = (value: NonNullable<RuleActionResult["revealed"]>) => void;

export type MatchDisclosureControls = {
  disabled: boolean;
  hiddenCaseDetails: (index: number) => HiddenCaseDetails | undefined;
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
  const [request, setRequest] = useState<RuleActionRequest>(),
    [error, setError] = useState("");
  const requestLock = useRef(false);
  const pending = !!request;
  const [confirmation, setConfirmation] = useState<{
    input: RuleActionRequest;
    quote: RuleActionQuote;
    onReveal?: OnReveal;
  }>();
  const anchor = useRef<HTMLButtonElement>(null);
  const interactedOutside = useRef(false);
  const confirmationId = useId();
  const [revealedCases, setRevealedCases] = useState<{
    submissionId: string;
    cases: Record<number, HiddenCaseDetails>;
  }>();
  const disabled = pending || match.state !== "active" || !!own?.forfeited;
  const confirmationOpen = !!confirmation && match.state === "active" && !own?.forfeited;
  useErrorNotification(error || undefined);
  function closeConfirmation() {
    setConfirmation(undefined);
    setError("");
  }
  const perform = async (
    input: RuleActionRequest,
    trigger: HTMLButtonElement,
    onReveal?: OnReveal,
  ) => {
    if (disabled || requestLock.current) return;
    if (!input.approval && confirmationOpen && trigger === anchor.current) {
      closeConfirmation();
      return;
    }
    requestLock.current = true;
    setRequest(input);
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
        return;
      } else {
        const opened = input.approval
          ? result
          : await matchRuleAction(identity, match.id, {
              ...selectedInput,
              approval: result.quote,
            });
        if (opened.revealed) onReveal?.(opened.revealed);
        closeConfirmation();
      }
      void client.invalidateQueries({ queryKey: ["match", identity, match.id] });
      if (input.kind === "topics" || input.kind === "complexity")
        void client.invalidateQueries({
          predicate: (q) => q.queryKey.includes(match.problemVersionId),
        });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reveal assistance.");
    } finally {
      requestLock.current = false;
      setRequest(undefined);
    }
  };
  function hiddenCaseDetails(index: number): HiddenCaseDetails | undefined {
    if (submission?.kind !== "submit" || submission.state !== "completed") return undefined;
    const submissionId = submission.id;
    const existing = revealedCases?.submissionId === submissionId && revealedCases.cases[index];
    if (existing) return existing;
    const access = match.rules.assistance.hiddenCase.access;
    if (access === "blocked" || match.state !== "active" || own?.forfeited) return undefined;
    const sameCase = (input?: RuleActionRequest) =>
      input?.kind === "hiddenCase" &&
      input.submissionId === submissionId &&
      input.caseIndex === index;
    const confirmingCase = confirmationOpen && sameCase(confirmation?.input);
    const loadingCase = !confirmingCase && sameCase(request);
    return {
      action: (
        <button
          type="button"
          className="button button-secondary"
          aria-disabled={disabled}
          aria-busy={loadingCase}
          aria-haspopup={access === "free" ? undefined : "dialog"}
          aria-expanded={access === "free" ? undefined : confirmingCase}
          onClick={(event) =>
            void perform(
              { kind: "hiddenCase", submissionId, caseIndex: index },
              event.currentTarget,
              ({ input, result }) => {
                if (!input || !result) throw new Error("Case details unavailable.");
                const example = JSON.parse(input) as NonNullable<HiddenCaseDetails["example"]>;
                const feedback = JSON.parse(result) as NonNullable<HiddenCaseDetails["result"]>;
                if (!Array.isArray(example?.args) || feedback?.index !== index || !feedback.status)
                  throw new Error("Case details unavailable.");
                setRevealedCases((previous) => ({
                  submissionId,
                  cases: {
                    ...(previous?.submissionId === submissionId ? previous.cases : {}),
                    [index]: { example, result: feedback },
                  },
                }));
              },
            )
          }
        >
          {loadingCase ? <Spinner size={18} /> : <Icon name="eye" />}
          Reveal case
        </button>
      ),
    };
  }
  const target =
    confirmation?.input.kind === "hiddenCase"
      ? `hidden case ${(confirmation.input.caseIndex ?? 0) + 1}`
      : confirmation?.input.kind === "topics"
        ? "topics"
        : "complexity";
  const cost = confirmation?.quote;
  const penalty = !!(cost?.seconds || cost?.points);
  const CostIcon = cost?.seconds ? Clock3 : Trophy;
  return (
    <>
      {children?.({
        disabled,
        hiddenCaseDetails,
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
              <div className="assistance-confirmation-heading">
                <h2 id={confirmationId}>Reveal {target}?</h2>
                <Tooltip content={revealNotice}>
                  <span
                    id={`${confirmationId}-notice`}
                    role="img"
                    aria-label={revealNotice}
                    tabIndex={0}
                  >
                    <Bell size={14} aria-hidden="true" />
                  </span>
                </Tooltip>
              </div>
              {cost && (
                <div
                  id={`${confirmationId}-cost`}
                  className="assistance-confirmation-cost"
                  data-penalty={penalty}
                >
                  {penalty && <CostIcon size={16} aria-hidden="true" />}
                  <span>
                    {cost.seconds
                      ? "Deducted from submission time"
                      : cost.points
                        ? "Deducted from score"
                        : "Reveal cost"}
                  </span>
                  <strong>{ruleCostLabel(cost)}</strong>
                </div>
              )}
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
                  aria-disabled={disabled}
                  aria-busy={!!request?.approval}
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
                  {request?.approval ? <Spinner /> : <Icon name="eye" width={16} height={16} />}
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
