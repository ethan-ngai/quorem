/** @file QuestionRowMetadata.tsx @description Shared filters within question catalog rows. @module practice */
import { formatLabel } from "../../ui/formatLabel";

export function QuestionTopics({
  tags,
  onFilter,
  disabled,
}: {
  tags: readonly string[];
  onFilter: (topic: string) => void;
  disabled?: boolean;
}) {
  const topics = tags.filter((tag) => tag.toLowerCase() !== "sql");
  if (!topics.length) return null;
  return (
    <div className="practice-topic-list">
      {topics.map((topic) => (
        <button
          key={topic}
          type="button"
          disabled={disabled}
          onClick={() => onFilter(topic)}
          aria-label={`Filter by ${formatLabel(topic)}`}
        >
          {formatLabel(topic)}
        </button>
      ))}
    </div>
  );
}

export function QuestionDifficulty({
  difficulty,
  onFilter,
  disabled,
}: {
  difficulty: string;
  onFilter: (difficulty: string) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`practice-difficulty ${difficulty}`}
      disabled={disabled}
      onClick={() => onFilter(difficulty)}
      aria-label={`Filter by ${formatLabel(difficulty)}`}
    >
      {formatLabel(difficulty)}
    </button>
  );
}
