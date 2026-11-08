import { DifficultySegments, type Difficulty } from "../../ui/DifficultySegments";
import "../../ui/selection-feedback.css";
import { formatLabel } from "../../ui/formatLabel";
import { Code2, Database } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { CatalogFilter } from "./CatalogFilter";
import { QuestionTypeFilter } from "./QuestionTypeFilter";
import { catalogKindChange, filterValues, type CatalogSearch } from "./catalogSearch";
import { SegmentedControl } from "../../ui/SegmentedControl";
import type { FoundationalTopic } from "./problemQueries";

const categories = [
  { value: "algorithms", label: "Algorithms", icon: <Code2 size={16} aria-hidden="true" /> },
  { value: "sql", label: "SQL", icon: <Database size={16} aria-hidden="true" /> },
] as const;

export function CatalogKindFilters({
  search,
  update,
  iconOnly = false,
}: {
  search: Pick<CatalogSearch, "sql" | "type">;
  iconOnly?: boolean;
  update: (change: ReturnType<typeof catalogKindChange>) => void;
}) {
  return (
    <>
      <SegmentedControl
        compact={!iconOnly}
        iconOnly={iconOnly}
        label="Question category"
        value={search.sql ? "sql" : "algorithms"}
        options={categories}
        onChange={(value) =>
          update(catalogKindChange({ sql: value === "sql" ? "true" : undefined }))
        }
      />
      <QuestionTypeFilter
        exclusive
        iconOnly={iconOnly}
        value={search.type}
        onChange={(type) => update(catalogKindChange({ type }))}
      />
    </>
  );
}

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

export function featuredTopicValues(topics: FoundationalTopic[] = []) {
  return new Map(
    topics.flatMap(({ label, tags, value }) =>
      [label, ...tags].map((tag) => [tag.toLowerCase(), value] as const),
    ),
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
  showKind = true,
}: {
  search: FilterSearch;
  update: (change: Partial<FilterSearch>) => void;
  topics: string[];
  foundationalTopics?: FoundationalTopic[];
  companies: string[];
  showDifficulty?: boolean;
  showKind?: boolean;
}) {
  const featured = foundationalTopics ?? [];
  const featuredValues = new Set(featured.map(({ value }) => value));
  const aliases = featuredTopicValues(featured);
  const selectedTopics = [
    ...new Set(filterValues(search.topic).map((tag) => aliases.get(tag.toLowerCase()) ?? tag)),
  ];
  const otherTopics = [
    ...new Set([...topics.filter((tag) => !aliases.has(tag.toLowerCase())), ...selectedTopics]),
  ]
    .filter((value) => !featuredValues.has(value) && value.toLowerCase() !== "sql")
    .map((value) => ({ value, label: formatLabel(value.replace(/^foundational:/, "")) }));
  return (
    <>
      {showKind && (
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
        </>
      )}
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
