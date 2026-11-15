import { useId } from "react";

export const topicGroupLabel = (group: string | null) => group ?? "Other questions";

export function PracticeTopicChecklist({
  options,
  hidden,
  onChange,
}: {
  options: (string | null)[];
  hidden: ReadonlySet<string | null>;
  onChange: (hidden: (string | null)[] | undefined) => void;
}) {
  const heading = useId();
  const canShowAll = options.some((group) => hidden.has(group));
  return (
    <aside className="practice-topic-sidebar" aria-labelledby={heading}>
      <div className="practice-topic-sidebar-header">
        <h2 id={heading}>Topic groups</h2>
        <button
          type="button"
          className="quiet-button"
          aria-disabled={!canShowAll}
          onClick={() => {
            if (canShowAll) onChange(undefined);
          }}
        >
          Show all
        </button>
      </div>
      <div className="practice-topic-checklist">
        {options.map((group) => (
          <label key={JSON.stringify(group)}>
            <input
              type="checkbox"
              checked={!hidden.has(group)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...hidden].filter((value) => value !== group)
                    : [...hidden, group],
                )
              }
            />
            <span>{topicGroupLabel(group)}</span>
          </label>
        ))}
      </div>
    </aside>
  );
}
