import { useServerTable } from "../../ui/useServerTable";
import { TablePagination, TableSortHeader } from "../../ui/TableControls";
import { QuestionDifficulty, QuestionTopics } from "./QuestionRowMetadata";
import { QuestionIndicators } from "./QuestionIndicators";
import {
  CatalogFilters,
  CatalogKindFilters,
  CompanyFilter,
  topicFilterValues,
} from "./CatalogFilters";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { CatalogLayout } from "./CatalogLayout";
import { TableRow, Table } from "../../ui/Table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { X, Layers, Globe, LockKeyhole } from "lucide-react";
import { useEffect, useMemo } from "react";
import { catalogQueryOptions, catalogFacets, catalogPageSize } from "./problemQueries";
import { warmWorkspacePage } from "../editor/preloadWorkspace";
import { useTheme } from "../editor/useTheme";
import { useAccountIdentity } from "../matches/MatchControls";
import { GlobalNav } from "../navigation/GlobalNav";
import { SearchField } from "../../ui/SearchField";
import { useServerSearch } from "../../ui/useServerSearch";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { addFilter, catalogSearch, filterValues } from "./catalogSearch";
import { PracticeRecommendations } from "./PracticeRecommendations";
import { defaultCatalogFormat } from "@quorem/contracts/catalog-filter";
import type { CatalogSearch } from "./catalogSearch";
import "../../styles/workspace.css";
import "./practice.css";

const practiceColumns = [{ accessorKey: "title" }, { accessorKey: "difficulty" }];

export function PracticeBrowser() {
  const { identity, account: session } = useAccountIdentity();
  const queryClient = useQueryClient();
  const actor = session.data === undefined ? undefined : identity;
  const { preference, setPreference } = useTheme();
  const rawSearch = useSearch({ from: "/practice" });
  const search = useMemo(() => catalogSearch(rawSearch), [rawSearch]);
  const { sql, type = defaultCatalogFormat } = search;
  const scope = { sql, type };
  const canChooseLibrary =
    session.data?.user.role === "admin" || !!session.data?.capabilities?.authorCustomQuestions;
  const library = search.library;
  const navigate = useNavigate({ from: "/practice" });
  const update = (change: Partial<CatalogSearch>, replace = false) => {
    void navigate({ search: (previous) => ({ ...previous, page: undefined, ...change }), replace });
  };
  const query = useServerSearch(search.q ?? "", (q) => update({ q: q || undefined }, true), search);
  const catalog = useQuery(catalogQueryOptions(queryClient, actor, { ...search, ...scope }));
  useEffect(() => {
    if (!catalog.data) return;
    const timer = window.setTimeout(warmWorkspacePage, 200);
    return () => window.clearTimeout(timer);
  }, [!!catalog.data]);
  const privateIdentityError =
    search.library === "private" && actor === undefined && session.isError;
  const { topics, foundationalTopics, topicAliases, companies, companyFacets } = catalogFacets(
    queryClient,
    actor,
    { ...search, ...scope },
    catalog.data,
  );
  const filtered = Boolean(
    search.q || search.difficulty || search.topic || search.company || library,
  );
  const topicValues = topicFilterValues(foundationalTopics, topicAliases);
  const selectTopic = (tag: string) => topicValues.get(tag.toLowerCase()) ?? tag;
  const filterTopic = (tag: string) =>
    update({
      topic: addFilter(filterValues(search.topic).map(selectTopic).join(","), selectTopic(tag)),
    });
  const clear = () => {
    query.reset();
    update({
      q: undefined,
      difficulty: undefined,
      topic: undefined,
      topicMatch: undefined,
      company: undefined,
      companyMatch: undefined,
      library: undefined,
    });
  };
  const pageSize = search.limit ?? catalogPageSize;
  const page = search.page ?? 1;
  const table = useServerTable({
    data: catalog.data?.items ?? [],
    columns: practiceColumns,
    total: catalog.data?.total,
    loading:
      catalog.isFetching ||
      catalog.isPlaceholderData ||
      (actor === undefined && library !== "global"),
    state: { page, limit: pageSize, sort: search.sort ?? "title", order: search.order ?? "asc" },
    onChange: (next) =>
      update({
        page: next.page === 1 ? undefined : next.page,
        limit: next.limit,
        sort: next.sort === "title" ? undefined : next.sort,
        order: next.order === "asc" ? undefined : next.order,
      }),
  });
  const total = catalog.data?.total ?? 0;
  return (
    <div className="practice-page">
      <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />
      <CatalogLayout
        title="Practice"
        description="Browse questions by topic, company and difficulty."
        actions={
          catalog.data && (
            <span className="practice-total">
              {total} {total === 1 ? "question" : "questions"}
            </span>
          )
        }
      >
        <div className="practice-filters">
          <CatalogKindFilters search={scope} update={update} />
        </div>
        <PracticeRecommendations
          key={JSON.stringify([actor, library, sql, type])}
          actor={actor}
          scope={{ ...scope, library }}
        />
        <div className="practice-toolbar">
          <SearchField
            className="practice-search"
            aria-label="Search questions"
            placeholder="Search questions or topics"
            value={query.text}
            onChange={(event) => query.change(event.target.value)}
            refreshing={catalog.isFetching && !!catalog.data}
          />
        </div>
        <div className="practice-filters">
          <CatalogFilters
            search={search}
            update={update}
            showKind={false}
            topics={topics}
            foundationalTopics={foundationalTopics}
            topicAliases={topicAliases}
            companies={companies}
            companyFacets={companyFacets}
          />
          {canChooseLibrary && (
            <SegmentedControl
              iconOnly
              label="Question library"
              value={search.library ?? "all"}
              onChange={(value) =>
                update({ library: value === "all" ? undefined : (value as "private" | "global") })
              }
              options={[
                {
                  value: "all",
                  label: "All questions",
                  icon: <Layers size={16} aria-hidden="true" />,
                },
                {
                  value: "global",
                  label: "Global questions",
                  icon: <Globe size={16} aria-hidden="true" />,
                },
                {
                  value: "private",
                  label: "Private library",
                  icon: <LockKeyhole size={16} aria-hidden="true" />,
                },
              ]}
            />
          )}
          {filtered && (
            <button
              type="button"
              className="button button-secondary practice-clear"
              aria-label="Clear filters"
              onClick={clear}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <section
          className="practice-catalog"
          aria-label="Practice questions"
          aria-busy={catalog.isFetching}
        >
          {privateIdentityError || catalog.isError ? (
            <div className="practice-state" role="alert">
              <p>Questions couldn’t load. Please try again.</p>
              <button
                className="button button-secondary practice-retry"
                onClick={() => void (privateIdentityError ? session.refetch() : catalog.refetch())}
              >
                Retry
              </button>
            </div>
          ) : catalog.isPending ? (
            <LoadingScreen inline label="Loading questions…" />
          ) : (
            <>
              <Table
                label="Practice questions"
                heading={
                  <tr>
                    <TableSortHeader column={table.getColumn("title")!}>Question</TableSortHeader>
                    <TableSortHeader column={table.getColumn("difficulty")!}>
                      Difficulty
                    </TableSortHeader>
                    <th aria-label="Question details and actions" />
                  </tr>
                }
              >
                {catalog.data.items.map((problem) => (
                  <TableRow
                    key={problem.id}
                    onPointerEnter={warmWorkspacePage}
                    onFocusCapture={warmWorkspacePage}
                    onOpen={(event) => {
                      const href = `/practice/${problem.slug}`;
                      if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
                      else void navigate({ to: "/practice/$slug", params: { slug: problem.slug } });
                    }}
                  >
                    <td>
                      <Link to="/practice/$slug" params={{ slug: problem.slug }}>
                        {problem.title}
                      </Link>
                      <QuestionTopics tags={problem.tags} onFilter={filterTopic} />
                    </td>
                    <td>
                      <QuestionDifficulty
                        difficulty={problem.difficulty}
                        onFilter={(difficulty) =>
                          update({ difficulty: addFilter(search.difficulty, difficulty) })
                        }
                      />
                    </td>
                    <td className="practice-format">
                      {problem.isPrivate && <QuestionIndicators privateQuestion />}
                    </td>
                  </TableRow>
                ))}
              </Table>
              {catalog.data.items.length === 0 && (
                <div className="practice-state">
                  <h2>{filtered ? "No matching questions" : "No questions available"}</h2>
                  <p>
                    {filtered
                      ? "Try another topic or a broader search."
                      : "Check back when new questions are published."}
                  </p>
                  <CompanyFilter
                    search={search}
                    update={update}
                    companies={companies}
                    companyFacets={companyFacets}
                  />
                  {filtered && (
                    <button className="button button-secondary practice-retry" onClick={clear}>
                      Clear filters
                    </button>
                  )}
                </div>
              )}
              <TablePagination
                table={table}
                snapshot={catalog.isPlaceholderData ? catalog.data : undefined}
              />
            </>
          )}
        </section>
      </CatalogLayout>
    </div>
  );
}
