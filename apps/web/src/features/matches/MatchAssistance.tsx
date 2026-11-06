/** @file MatchAssistance.tsx @description Explicit paid reveals and match cost history. @module matches */
import { useState } from "react";
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
  cost.seconds ? `+${cost.seconds}s` : cost.points ? `−${cost.points} points` : "Free";
export function MatchAssistance({
  match,
  identity,
  submission,
  complexityAvailable,
  onPaidAction,
}: {
  match: MatchSnapshot;
  identity: DevelopmentIdentity;
  submission?: Submission;
  complexityAvailable: boolean;
  onPaidAction?: (input: RuleActionRequest) => Promise<void>;
}) {
  const client = useQueryClient();
  const own = ownParticipant(match, identity);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    input: RuleActionRequest;
    quote: RuleActionQuote;
  }>();
  const [revealed, setRevealed] = useState<RuleActionResult["revealed"]>();
  const perform = async (input: RuleActionRequest) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await matchRuleAction(identity, match.id, input);
      const selectedInput = {
        ...input,
        ...(result.quote.caseIndex !== undefined ? { caseIndex: result.quote.caseIndex } : {}),
      };
      if (!input.approval && (result.quote.seconds || result.quote.points)) {
        if (onPaidAction) await onPaidAction(selectedInput);
        else setConfirmation({ input: selectedInput, quote: result.quote });
      } else if (!input.approval) {
        const opened = await matchRuleAction(identity, match.id, {
          ...selectedInput,
          approval: result.quote,
        });
        setRevealed(opened.revealed);
      } else {
        setRevealed(result.revealed);
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
  const disabled = pending || match.state !== "active" || own?.forfeited;
  const hasFailure =
    submission?.kind === "submit" &&
    submission.state === "completed" &&
    submission.score &&
    submission.score.passed < submission.score.total;
  return (
    <section className="match-assistance" aria-label="Match assistance">
      <div className="match-assistance-actions">
        {(
          [
            ["topics", "Topics"],
            ["complexity", "Complexity"],
          ] as const
        ).map(
          ([kind, label]) =>
            match.rules.assistance[kind].access !== "blocked" &&
            (kind !== "complexity" || complexityAvailable) && (
              <button
                key={kind}
                className="quiet-button"
                disabled={disabled}
                onClick={() => void perform({ kind })}
              >
                {label}
              </button>
            ),
        )}
        {match.rules.assistance.hiddenCase.access !== "blocked" && hasFailure && (
          <button
            className="quiet-button"
            disabled={disabled}
            onClick={() => void perform({ kind: "hiddenCase", submissionId: submission!.id })}
          >
            Reveal a failed case
          </button>
        )}
      </div>
      <NoticeRegion message={error} label="Assistance unavailable">
        {null}
      </NoticeRegion>
      {revealed?.topics && <p>{revealed.topics.join(" · ")}</p>}
      {revealed?.complexity && <ComplexityReveal raw={revealed.complexity} />}
      {revealed?.input && (
        <details open>
          <summary>Revealed hidden case</summary>
          <strong>Input and expected output</strong>
          <pre>{revealed.input}</pre>
          <strong>Your result</strong>
          <pre>{revealed.result}</pre>
        </details>
      )}
      <SessionDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(undefined);
        }}
        pending={pending}
        title="Reveal assistance?"
        description={`Cost: ${confirmation ? ruleCostLabel(confirmation.quote) : ""}. This reveal is announced to the match.`}
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
              confirmation && void perform({ ...confirmation.input, approval: confirmation.quote })
            }
          >
            Reveal
          </button>
        </div>
      </SessionDialog>
    </section>
  );
}
import { ComplexityDetails } from "../editor/components/ComplexityDetails";
import type { ApproachComplexity } from "@quorem/contracts";
function ComplexityReveal({ raw }: { raw: string }) {
  const value = JSON.parse(raw) as { items: ApproachComplexity[] };
  return (
    <div>
      {value.items.map((item, index) => (
        <ComplexityDetails key={index} value={item} />
      ))}
    </div>
  );
}
