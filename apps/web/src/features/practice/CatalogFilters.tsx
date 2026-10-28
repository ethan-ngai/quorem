import { DifficultySegments, type Difficulty } from "../../ui/DifficultySegments";
import "../../ui/selection-feedback.css";
import { formatLabel } from "../../ui/formatLabel";
import { Database } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { CatalogFilter } from "./CatalogFilter";
import { QuestionTypeFilter } from "./QuestionTypeFilter";
import { filterValues, type CatalogSearch } from "./catalogSearch";

export function CatalogFilters({
  search,
  update,
  topics,
  companies,
  showDifficulty = true,
}: {
  search: CatalogSearch;
  update: (change: Partial<CatalogSearch>) => void;
  topics: string[];
  companies: string[];
  showDifficulty?: boolean;
}) {
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
        selected={filterValues(search.topic)}
        onChange={(values) => update({ topic: values.join(",") || undefined })}
        options={[...new Set([...topics, ...filterValues(search.topic)])]
          .filter((value) => value.toLowerCase() !== "sql")
          .map((value) => ({ value, label: formatLabel(value) }))}
      />
      <CatalogFilter
        label="Companies"
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
