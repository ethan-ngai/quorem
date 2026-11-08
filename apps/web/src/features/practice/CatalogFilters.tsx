import { DifficultySegments, type Difficulty } from "../../ui/DifficultySegments";
import "../../ui/selection-feedback.css";
import { formatLabel } from "../../ui/formatLabel";
import { Database } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { CatalogFilter } from "./CatalogFilter";
import { QuestionTypeFilter } from "./QuestionTypeFilter";
import { filterValues, type CatalogSearch } from "./catalogSearch";
import type { FoundationalTopic } from "./problemQueries";

export function CatalogFilters({
  search,
  update,
  topics,
  foundationalTopics,
  companies,
  showDifficulty = true,
}: {
  search: Pick<CatalogSearch, "type" | "sql" | "difficulty" | "topic" | "company">;
  update: (change: Partial<CatalogSearch>) => void;
  topics: string[];
  foundationalTopics?: FoundationalTopic[];
  companies: string[];
  showDifficulty?: boolean;
}) {
  const selectedTopics = filterValues(search.topic);
  const featured = foundationalTopics ?? [];
  const featuredValues = new Set(featured.map(({ value }) => value));
  const featuredTags = new Set(featured.flatMap(({ tags }) => tags));
  const otherTopics = [
    ...new Set([...topics.filter((tag) => !featuredTags.has(tag)), ...selectedTopics]),
  ]
    .filter((value) => !featuredValues.has(value) && value.toLowerCase() !== "sql")
    .map((value) => ({ value, label: formatLabel(value.replace(/^foundational:/, "")) }));
  return (
    <>
      <QuestionTypeFilter value={search.type} onChange={(type) => update({ type })} />
      <Tooltip content="SQL questions">
        <button
          type="button"
          className="catalog-sql-toggle selection-feedback"
          aria-label="SQL questions"
          aria-pressed={search.sql === "true"}
          onClick={() => update({ sql: search.sql === "true" ? undefined : "true" })}
        >
          <Database size={16} aria-hidden="true" />
        </button>
      </Tooltip>
      {showDifficulty && (
        <DifficultySegments
          selected={filterValues(search.difficulty) as Difficulty[]}
          onChange={(values) => update({ difficulty: values.join(",") || undefined })}
        />
      )}
      <CatalogFilter
        label="Topics"
        selected={selectedTopics}
        onChange={(values) => update({ topic: values.join(",") || undefined })}
        options={otherTopics}
        featuredOptions={featured}
      />
      <CatalogFilter
        label="Companies"
        searchPlaceholder="Search companies"
        selected={filterValues(search.company)}
        onChange={(values) => update({ company: values.join(",") || undefined })}
        options={[...new Set([...companies, ...filterValues(search.company)])].map((value) => ({
          value,
          label: value,
        }))}
      />
    </>
  );
}
