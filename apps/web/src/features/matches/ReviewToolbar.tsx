import type { MatchReview } from "@quorem/contracts";
import { SelectField } from "../../ui/SelectField";

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
}) {
  return (
    <div className="review-toolbar">
      <SelectField
        label="Editing"
        value={participantId}
        disabled={disabled}
        options={review.participants.map((person) => ({
          value: person.userId,
          label: person.own ? "Your draft" : `Your copy of ${person.displayName}`,
        }))}
        onChange={onSelect}
      />
      {review.participants.some(
        (person) => person.userId !== participantId && person.submission,
      ) && (
        <button className="quiet-button" aria-pressed={compare} onClick={onCompare}>
          Compare
        </button>
      )}
      {compare && canDiff && (
        <button className="quiet-button" aria-pressed={diff} onClick={onDiff}>
          Diff
        </button>
      )}
      {review.participants.find((person) => person.userId === participantId)?.submission && (
        <button className="quiet-button" aria-pressed={original} onClick={onOriginal}>
          Original submission
        </button>
      )}
      {!review.shareCodeAfterMatch && <span>Opponent code sharing was off.</span>}
    </div>
  );
}
