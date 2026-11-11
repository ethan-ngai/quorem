import { DifficultySegments, type Difficulty } from "../../ui/DifficultySegments";
import "../../ui/selection-feedback.css";
import { formatLabel } from "../../ui/formatLabel";
import { Code2, Database } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { CatalogFilter, type FilterGroup } from "./CatalogFilter";
import { QuestionTypeFilter } from "./QuestionTypeFilter";
import { catalogKindChange, filterValues, type CatalogSearch } from "./catalogSearch";
import { SegmentedControl } from "../../ui/SegmentedControl";
import type { CompanyFacet, FoundationalTopic } from "./problemQueries";

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

const companyTiers = [
  ["faang", "FAANG"],
  ["top", "Top Companies"],
  ["quant", "Quant"],
  ["mid-tier", "Mid-Tier"],
  ["other", "Other Companies"],
] as const;

export function CompanyFilter({
  search,
  update,
  companies,
  companyFacets,
}: {
  search: Pick<CatalogSearch, "company" | "companyMatch">;
  update: (change: Partial<Pick<CatalogSearch, "company" | "companyMatch">>) => void;
  companies: string[];
  companyFacets?: CompanyFacet[];
}) {
  const selected = filterValues(search.company);
  const known = new Set(companies);
  const missing = selected.filter((name) => !known.has(name));
  const option = (name: string, count?: number) => ({ value: name, label: name, count });
  const groups: FilterGroup[] = companyFacets
    ? companyTiers.map(([tier, label]) => ({
        label,
        options: [
          ...companyFacets
            .filter((company) => company.tier === tier)
            .map(({ name, count }) => option(name, count)),
          ...(tier === "other" ? missing.map((name) => option(name)) : []),
        ],
      }))
    : [{ options: [...companies, ...missing].map((name) => option(name)) }];
  return (
    <CatalogFilter
      label="Companies"
      searchPlaceholder="Search companies"
      selected={selected}
      onChange={(values) => update({ company: values.join(",") || undefined })}
      match={search.companyMatch}
      onMatchChange={(match) => update({ companyMatch: match === "all" ? match : undefined })}
      groups={groups}
    />
  );
}

export function topicFilterValues(
  topics: FoundationalTopic[] = [],
  aliases: Record<string, string> = {},
) {
  return new Map([
    ...Object.entries(aliases),
    ...topics.flatMap(({ label, tags, value }) =>
      [label, ...tags].map((tag) => [tag.toLowerCase(), value] as const),
    ),
  ]);
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
  topicAliases,
  companies,
  companyFacets,
  showDifficulty = true,
  showKind = true,
}: {
  search: FilterSearch;
  update: (change: Partial<FilterSearch>) => void;
  topics: string[];
  foundationalTopics?: FoundationalTopic[];
  topicAliases?: Record<string, string>;
  companies: string[];
  companyFacets?: CompanyFacet[];
  showDifficulty?: boolean;
  showKind?: boolean;
}) {
  const featured = foundationalTopics ?? [];
  const featuredValues = new Set(featured.map(({ value }) => value));
  const aliases = topicFilterValues(featured, topicAliases);
  const selectedTopics = [
    ...new Set(filterValues(search.topic).map((tag) => aliases.get(tag.toLowerCase()) ?? tag)),
  ];
  const otherTopics = [
    ...new Set([...topics.map((tag) => aliases.get(tag.toLowerCase()) ?? tag), ...selectedTopics]),
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
        groups={
          foundationalTopics
            ? [
                { label: "Foundational", options: featured },
                { label: "Other topics", options: otherTopics },
              ]
            : [{ options: otherTopics }]
        }
      />
      <CompanyFilter
        search={search}
        update={update}
        companies={companies}
        companyFacets={companyFacets}
      />
    </>
  );
}
