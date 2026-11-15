/** @file PracticeTopicIndex.tsx @description Topic navigation for grouped practice. @module practice */
export const topicGroupLabel = (group: string | null) => group ?? "Other questions";

export function PracticeTopicIndex({
  options,
  selected,
  onChange,
}: {
  options: readonly (string | null)[];
  selected: string | null | undefined;
  onChange: (group: string | null | undefined) => void;
}) {
  return (
    <nav className="practice-topic-index" aria-label="Topic groups">
      <ul>
        {[undefined, ...options].map((group) => (
          <li key={JSON.stringify(group) ?? "all"}>
            <button
              type="button"
              aria-current={group === selected ? "true" : undefined}
              onClick={() => {
                if (group !== selected) onChange(group);
              }}
            >
              {group === undefined ? "All topics" : topicGroupLabel(group)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
