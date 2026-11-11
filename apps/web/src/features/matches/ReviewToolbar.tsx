/** @file ReviewToolbar.tsx @description Compact review navigation and aligned code pane headers. @module matches */
import type { ReactNode } from "react";
import type { MatchReview } from "@quorem/contracts";
import {
  Columns2,
  FileCode2,
  GitCompareArrows,
  History,
  LockKeyhole,
  Pencil,
  ArrowLeftRight,
} from "lucide-react";
import * as Popover from "../../ui/Popover";
import { SelectField } from "../../ui/SelectField";
import { AccountAvatar } from "../navigation/AccountAvatar";
import { participantColor } from "../collaboration/participantColor";
import { ParticipantName, type ParticipantIdentity } from "../collaboration/ParticipantName";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Tooltip } from "../../ui/Tooltip";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { languageLabels, type EditorLanguage } from "../editor/editorLanguages";

export function ReviewToolbar({
  review,
  participantId,
  disabled,
  compare,
  diff,
  canCompare,
  canDiff,
  originalLabel = "Original submission",
  original,
  onSelect,
  onCompare,
  onDiff,
  onOriginal,
  children,
  originalContent,
}: {
  review: { participants: MatchReview["participants"]; shareCodeAfterMatch?: boolean };
  participantId: string;
  disabled: boolean;
  compare: boolean;
  diff: boolean;
  canCompare: boolean;
  canDiff: boolean;
  originalLabel?: string;
  original: boolean;
  onSelect: (value: string) => void;
  onCompare: () => void;
  onDiff: () => void;
  onOriginal: () => void;
  children?: ReactNode;
  originalContent?: ReactNode;
}) {
  return (
    <div className="code-toolbar review-toolbar">
      <SelectField
        className="select-field--compact"
        label="Code author"
        value={participantId}
        disabled={disabled}
        options={review.participants.map((person) => ({
          value: person.userId,
          label:
            person.own || person.finalCode || person.submission
              ? person.displayName
              : `${person.displayName} · No saved code`,
          display: person.own ? (
            <Tooltip content="You">
              <span aria-hidden="true">{person.displayName}</span>
            </Tooltip>
          ) : undefined,
          leading: (
            <AccountAvatar
              name={person.displayName}
              image={person.image}
              color={participantColor(person.userId, person.color)}
              outline
            />
          ),
        }))}
        onChange={onSelect}
      />
      {children}
      <div className="review-view-controls">
        {canCompare && (
          <SegmentedControl
            label="Code view"
            compact
            iconOnly
            value={compare ? (diff && canDiff ? "diff" : "split") : "single"}
            options={[
              { value: "single", label: "Single editor", icon: <FileCode2 size={16} /> },
              { value: "split", label: "Split view", icon: <Columns2 size={16} /> },
              ...(canDiff
                ? [{ value: "diff", label: "Diff", icon: <GitCompareArrows size={16} /> }]
                : []),
            ]}
            onChange={(value) => {
              if ((value !== "single") !== compare) onCompare();
              if ((value === "diff") !== diff) onDiff();
            }}
          />
        )}
        {originalContent && (
          <Popover.Root
            open={original}
            onOpenChange={(next) => {
              if (next !== original) onOriginal();
            }}
          >
            <Tooltip content={originalLabel}>
              <Popover.Trigger asChild>
                <button className="icon-button" aria-label={originalLabel} aria-pressed={original}>
                  <History size={16} />
                </button>
              </Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
              <Popover.Content className="review-original" align="end" aria-label={originalLabel}>
                {originalContent}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
        {review.shareCodeAfterMatch === false && (
          <Tooltip content="Code sharing was off for this round">
            <span
              className="review-state-icon"
              tabIndex={0}
              role="img"
              aria-label="Code sharing off"
            >
              <LockKeyhole size={14} />
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export function ReviewPaneHeader({
  name,
  language,
  active = false,
  original = false,
  onSelect,
  disabled,
  participant,
  self = false,
}: {
  name: string;
  participant?: ParticipantIdentity;
  self?: boolean;
  language: EditorLanguage;
  active?: boolean;
  original?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
}) {
  const status = original
    ? name
    : active
      ? "Editable copy · Run and Submit use this editor"
      : "Comparison reference";
  return (
    <div className="review-pane-header" data-active={active || undefined}>
      <LanguageLogo language={language} tooltip={languageLabels[language]} />
      <span className="review-pane-name">
        {participant ? (
          <ParticipantName participant={participant} label={name} self={self} />
        ) : (
          name
        )}
      </span>
      <Tooltip content={status}>
        <span className="review-state-icon" role="img" tabIndex={0} aria-label={status}>
          {original ? (
            <History size={13} />
          ) : active ? (
            <Pencil size={13} />
          ) : (
            <LockKeyhole size={13} />
          )}
        </span>
      </Tooltip>
      {onSelect && (
        <Tooltip content={`Edit ${self ? "your" : name + "'s"} copy`}>
          <button
            className="icon-button"
            disabled={disabled}
            aria-label={`Edit ${self ? "your" : name + "'s"} copy`}
            onClick={onSelect}
          >
            <ArrowLeftRight size={14} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
