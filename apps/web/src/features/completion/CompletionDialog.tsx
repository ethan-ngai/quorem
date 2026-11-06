/** @file CompletionDialog.tsx @description Shared completion composition for practice and competition. @module completion */
import type { ReactNode } from "react";
import { Trophy } from "lucide-react";
import { SessionDialog } from "../../ui/SessionDialog";
import { CompletionOutcomeIcon } from "../../ui/CompletionOutcomeIcon";
import type { CompletionOutcome } from "../../ui/completionOutcome";
import { Celebration } from "../../ui/Celebration";
import "./completion.css";

export function CompletionDialog({
  open,
  onOpenChange,
  title,
  description,
  descriptionHidden = false,
  context,
  outcome,
  competitive = false,
  celebrate = true,
  stats,
  children,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  descriptionHidden?: boolean;
  context: ReactNode;
  outcome: CompletionOutcome;
  competitive?: boolean;
  celebrate?: boolean;
  stats?: { label: string; value: ReactNode; hideLabel?: boolean; numeric?: boolean }[];
  children?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <SessionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <>
          <CompletionOutcomeIcon
            outcome={outcome}
            successIcon={competitive ? <Trophy size={20} /> : undefined}
          />
          {title}
        </>
      }
      description={description}
      descriptionHidden={descriptionHidden}
      className="completion-dialog"
      closeLabel="Close summary"
    >
      {open && celebrate && <Celebration outcome={outcome} />}
      <div className="completion-context">{context}</div>
      {stats && (
        <dl className="completion-stats">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className={stat.hideLabel ? "sr-only" : undefined}>{stat.label}</dt>
              <dd className={stat.numeric ? "completion-count" : undefined}>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
      <footer className="completion-actions">{actions}</footer>
    </SessionDialog>
  );
}
