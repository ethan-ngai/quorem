/** @file QuestionRowMetadata.tsx @description Shared filters within question catalog rows. @module practice */
import { Link } from "@tanstack/react-router";
import "../../ui/topic-chip.css";
import { formatLabel } from "../../ui/formatLabel";

export function QuestionTopics({
  tags,
  onFilter,
  disabled,
  linkToFilter = false,
}: {
  tags: readonly string[];
  onFilter?: (topic: string) => void;
  disabled?: boolean;
  linkToFilter?: boolean;
}) {
  const topics = tags.filter((tag) => tag.toLowerCase() !== "sql");
  if (!topics.length) return null;
  return (
    <div className="practice-topic-list">
      {topics.map((topic) =>
        onFilter ? (
          <button
            data-table-filter
            key={topic}
            className="topic-chip"
            type="button"
            disabled={disabled}
            onClick={() => onFilter(topic)}
            aria-label={`Filter by ${formatLabel(topic)}`}
          >
            {formatLabel(topic)}
          </button>
        ) : linkToFilter ? (
          <Link key={topic} className="topic-chip" to="/practice" search={{ topic }}>
            {formatLabel(topic)}
          </Link>
        ) : (
          <span key={topic} className="topic-chip">
            {formatLabel(topic)}
          </span>
        ),
      )}
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
      data-table-filter
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
