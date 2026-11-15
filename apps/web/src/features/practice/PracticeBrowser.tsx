import { LoadingButton } from "../../ui/LoadingButton";
import {
  CatalogFilters,
  CatalogKindFilters,
  CompanyFilter,
  topicFilterValues,
} from "./CatalogFilters";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { CatalogLayout } from "./CatalogLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { X, Layers, Globe, List, ListTree, LockKeyhole } from "lucide-react";
import { useEffect, useMemo } from "react";
import { catalogQueryOptions, catalogFacets, catalogPageSize } from "./problemQueries";
import { warmWorkspacePage } from "../editor/preloadWorkspace";
import { useTheme } from "../editor/useTheme";
import { useAccountIdentity } from "../matches/MatchControls";
import { DailyStreak } from "../activity/DailyStreak";
import { sampleActiveStreakDays } from "../activity/streakFixtures";
import { GlobalNav } from "../navigation/GlobalNav";
import { SearchField } from "../../ui/SearchField";
import { useServerSearch } from "../../ui/useServerSearch";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { addFilter, catalogSearch, filterValues } from "./catalogSearch";
import { PracticeTopicAccordion } from "./PracticeTopicAccordion";
import { PracticeQuestionTable, type PracticeTableState } from "./PracticeQuestionTable";
import { PracticeRecommendations } from "./PracticeRecommendations";
import { defaultCatalogFormat } from "@quorem/contracts/catalog-filter";
import type { CatalogSearch } from "./catalogSearch";
import "../../styles/workspace.css";
import "./practice.css";

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
  const update = (
    change: Partial<CatalogSearch>,
    options?: { replace?: boolean; resetScroll?: boolean },
  ) => {
    void navigate({
      search: (previous) => ({ ...previous, page: undefined, ...change }),
      ...options,
    });
  };
  const query = useServerSearch(
    search.q ?? "",
    (q) => update({ q: q || undefined }, { replace: true }),
    search,
  );
  const { topicGroup, ...browse } = { ...search, ...scope };
  const { page, limit, sort, order, ...filters } = browse;
  const grouped = search.groupBy === "topic";
  const catalog = useQuery(
    catalogQueryOptions(queryClient, actor, grouped ? { ...filters, limit: 1 } : browse),
  );
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
      topicGroup: undefined,
    });
  };
  const rowFilters = {
    filterTopic,
    filterDifficulty: (difficulty: string) =>
      update({ difficulty: addFilter(search.difficulty, difficulty) }),
  };
  const tableState: PracticeTableState = {
    page: page ?? 1,
    limit: limit ?? catalogPageSize,
    sort: sort ?? "title",
    order: order ?? "asc",
  };
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
        <div className="practice-recommendations-row">
          <PracticeRecommendations
            key={JSON.stringify([actor, library, sql, type])}
            actor={actor}
            scope={{ ...scope, library }}
          />
          {import.meta.env.DEV && <DailyStreak days={sampleActiveStreakDays} />}
        </div>
        <div className="practice-toolbar">
          <SearchField
            className="practice-search"
            aria-label="Search questions"
            placeholder="Search questions or topics"
            value={query.text}
            onChange={(event) => query.change(event.target.value)}
            refreshing={catalog.isFetching && !!catalog.data}
          />
          <SegmentedControl
            iconOnly
            label="Question layout"
            value={search.groupBy ?? "list"}
            onChange={(value) => update({ groupBy: value === "topic" ? value : undefined })}
            options={[
              { value: "list", label: "List", icon: <List size={16} aria-hidden="true" /> },
              {
                value: "topic",
                label: "Group by topic",
                icon: <ListTree size={16} aria-hidden="true" />,
              },
            ]}
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
                update({
                  library: value === "all" ? undefined : (value as "private" | "global"),
                  topicGroup: undefined,
                })
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
              <LoadingButton
                className="button button-secondary practice-retry"
                onClick={() => void (privateIdentityError ? session.refetch() : catalog.refetch())}
                pending={privateIdentityError ? session.isFetching : catalog.isFetching}
              >
                Retry
              </LoadingButton>
            </div>
          ) : catalog.isPending ? (
            <LoadingScreen inline label="Loading questions…" />
          ) : (
            <>
              {grouped ? (
                <div className="practice-topic-accordions">
                  {catalog.data.topicGroupStats?.map((group) => (
                    <PracticeTopicAccordion
                      key={JSON.stringify([group.label, actor, library, sql, type])}
                      actor={actor}
                      filters={filters}
                      group={group}
                      initiallyOpen={topicGroup === group.label}
                      rowFilters={rowFilters}
                    />
                  ))}
                </div>
              ) : (
                <PracticeQuestionTable
                  data={catalog.data}
                  placeholder={catalog.isPlaceholderData}
                  fetching={catalog.isFetching || (actor === undefined && library !== "global")}
                  state={tableState}
                  onChange={(next) =>
                    update({
                      page: next.page === 1 ? undefined : next.page,
                      limit: next.limit,
                      sort: next.sort === "title" ? undefined : next.sort,
                      order: next.order === "asc" ? undefined : next.order,
                    })
                  }
                  {...rowFilters}
                />
              )}
              {total === 0 && (
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
            </>
          )}
        </section>
      </CatalogLayout>
    </div>
  );
}
