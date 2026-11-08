import { DifficultySegments, type Difficulty } from "../../ui/DifficultySegments";
import "../../ui/selection-feedback.css";
import { formatLabel } from "../../ui/formatLabel";
import { Database } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { CatalogFilter } from "./CatalogFilter";
import { QuestionTypeFilter } from "./QuestionTypeFilter";
import { filterValues, type CatalogSearch } from "./catalogSearch";
import type { FoundationalTopic } from "./problemQueries";

export function CompanyFilter({
  search,
  update,
  companies,
}: {
  search: Pick<CatalogSearch, "company" | "companyMatch">;
  update: (change: Partial<Pick<CatalogSearch, "company" | "companyMatch">>) => void;
  companies: string[];
}) {
  const selected = filterValues(search.company);
  return (
    <CatalogFilter
      label="Companies"
      searchPlaceholder="Search companies"
      selected={selected}
      onChange={(values) => update({ company: values.join(",") || undefined })}
      match={search.companyMatch}
      onMatchChange={(match) => update({ companyMatch: match === "all" ? match : undefined })}
      options={[...new Set([...companies, ...selected])].map((value) => ({
        value,
        label: value,
      }))}
    />
  );
}

type FilterSearch = Pick<
  CatalogSearch,
  "type" | "sql" | "difficulty" | "topic" | "topicMatch" | "company" | "companyMatch"
>;

export function CatalogFilters({
  search,
  update,
  topics,
  foundationalTopics,
  companies,
  showDifficulty = true,
}: {
  search: FilterSearch;
  update: (change: Partial<FilterSearch>) => void;
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
        match={search.topicMatch}
        onMatchChange={(match) => update({ topicMatch: match === "all" ? match : undefined })}
        options={otherTopics}
        featuredOptions={featured}
      />
      <CompanyFilter search={search} update={update} companies={companies} />
    </>
  );
}
