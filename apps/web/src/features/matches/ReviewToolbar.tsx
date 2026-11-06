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
  canDiff,
  original,
  onSelect,
  onCompare,
  onDiff,
  onOriginal,
  children,
  originalContent,
}: {
  review: MatchReview;
  participantId: string;
  disabled: boolean;
  compare: boolean;
  diff: boolean;
  canDiff: boolean;
  original: boolean;
  onSelect: (value: string) => void;
  onCompare: () => void;
  onDiff: () => void;
  onOriginal: () => void;
  children?: ReactNode;
  originalContent?: ReactNode;
}) {
  const multiple = review.participants.some(
    (person) => person.userId !== participantId && person.submission,
  );
  return (
    <div className="code-toolbar review-toolbar">
      <SelectField
        className="select-field--compact"
        label="Code author"
        value={participantId}
        disabled={disabled}
        options={review.participants.map((person) => ({
          value: person.userId,
          label: person.own ? "You" : person.displayName,
        }))}
        onChange={onSelect}
      />
      {children}
      <div className="review-view-controls">
        {multiple && (
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
        {review.participants.find((person) => person.userId === participantId)?.submission && (
          <Popover.Root
            open={original}
            onOpenChange={(next) => {
              if (next !== original) onOriginal();
            }}
          >
            <Tooltip content="Original submission">
              <Popover.Trigger asChild>
                <button
                  className="icon-button"
                  aria-label="Original submission"
                  aria-pressed={original}
                >
                  <History size={16} />
                </button>
              </Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
              <Popover.Content
                className="review-original"
                align="end"
                aria-label="Original submission"
              >
                {originalContent}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
        {!review.shareCodeAfterMatch && (
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
}: {
  name: string;
  language: EditorLanguage;
  active?: boolean;
  original?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
}) {
  const status = original
    ? "Original submission"
    : active
      ? "Editable copy · Run and Submit use this editor"
      : "Comparison reference";
  return (
    <div className="review-pane-header" data-active={active || undefined}>
      <LanguageLogo language={language} tooltip={languageLabels[language]} />
      <span className="review-pane-name">{name}</span>
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
        <Tooltip content={`Edit ${name === "You" ? "your" : name + "'s"} copy`}>
          <button
            className="icon-button"
            disabled={disabled}
            aria-label={`Edit ${name === "You" ? "your" : name + "'s"} copy`}
            onClick={onSelect}
          >
            <ArrowLeftRight size={14} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
