import { QuestionTypeFilter } from "./QuestionTypeFilter";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { CatalogLayout, CatalogTable } from "./CatalogLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Layers,
  Globe,
  LockKeyhole,
} from "lucide-react";
import { useEffect, useState } from "react";
import { catalogQueryOptions, catalogFacets, catalogPageSize as pageSize } from "./problemQueries";
import { warmWorkspacePage } from "../editor/preloadWorkspace";
import { useTheme } from "../editor/useTheme";
import { useAccountIdentity } from "../matches/MatchControls";
import { GlobalNav } from "../navigation/GlobalNav";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { CatalogFilter } from "./CatalogFilter";
import { addFilter, filterValues } from "./catalogSearch";
import type { CatalogSearch } from "./catalogSearch";
import "../../styles/workspace.css";
import "./practice.css";

const label = (value: string) =>
  value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function PracticeBrowser() {
  const { identity, account: session } = useAccountIdentity();
  const queryClient = useQueryClient();
  const actor = session.data === undefined ? undefined : identity;
  const { preference, setPreference } = useTheme();
  const search = useSearch({ from: "/practice" });
  const canChooseLibrary =
    session.data?.user.role === "admin" || !!session.data?.capabilities?.authorCustomQuestions;
  const library = search.library;
  const navigate = useNavigate({ from: "/practice" });
  const [query, setQuery] = useState(search.q ?? "");
  const [editing, setEditing] = useState(false);
  const update = (change: Partial<CatalogSearch>, replace = false) => {
    void navigate({ search: (previous) => ({ ...previous, page: undefined, ...change }), replace });
  };
  // Back/forward replaces input state; pending input must never overwrite a restored URL.
  useEffect(() => {
    setQuery(search.q ?? "");
    setEditing(false);
  }, [search]);
  useEffect(() => {
    if (!editing) return;
    const timer = window.setTimeout(() => {
      update({ q: query.trim() || undefined }, true);
      setEditing(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, editing, search]);
  const catalog = useQuery(catalogQueryOptions(queryClient, actor, search));
  useEffect(() => {
    if (!catalog.data) return;
    const timer = window.setTimeout(warmWorkspacePage, 200);
    return () => window.clearTimeout(timer);
  }, [!!catalog.data]);
  const privateIdentityError =
    search.library === "private" && actor === undefined && session.isError;
  const { topics, companies } = catalogFacets(queryClient, actor, search, catalog.data);
  const filtered = Boolean(
    search.q || search.difficulty || search.topic || search.company || library || search.type,
  );
  const sort = search.sort ?? "title";
  const SortIcon = search.order === "desc" ? ArrowDown : ArrowUp;
  const sortBy = (next: "title" | "difficulty") =>
    update({
      sort: next === "title" ? undefined : next,
      order: sort === next && !search.order ? "desc" : undefined,
    });
  const clear = () => {
    setQuery("");
    setEditing(false);
    update({
      q: undefined,
      difficulty: undefined,
      topic: undefined,
      company: undefined,
      library: undefined,
      type: undefined,
    });
  };
  const page = search.page ?? 1;
  const total = catalog.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (
      (actor !== undefined || library === "global") &&
      catalog.data &&
      !catalog.isFetching &&
      page > pages
    )
      update({ page: pages === 1 ? undefined : pages }, true);
  }, [actor, library, catalog.data, catalog.isFetching, page, pages]);
  return (
    <div className="practice-page">
      <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />
      <CatalogLayout
        title="Practice"
        description="Browse questions by topic, company and difficulty."
        actions={
          <span className="practice-total">
            {total} {total === 1 ? "question" : "questions"}
          </span>
        }
      >
        <div className="practice-toolbar">
          <label className="practice-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search questions"
              placeholder="Search questions or topics"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setEditing(true);
              }}
            />
          </label>
        </div>
        <div className="practice-filters">
          <QuestionTypeFilter value={search.type} onChange={(type) => update({ type })} />
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
          <CatalogFilter
            label="Difficulty"
            selected={filterValues(search.difficulty)}
            onChange={(values) => update({ difficulty: values.join(",") || undefined })}
            options={["easy", "medium", "hard"].map((value) => ({ value, label: label(value) }))}
          />
          <CatalogFilter
            label="Topics"
            selected={filterValues(search.topic)}
            onChange={(values) => update({ topic: values.join(",") || undefined })}
            options={[...new Set([...topics, ...filterValues(search.topic)])].map((value) => ({
              value,
              label: label(value),
            }))}
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
          {filtered && (
            <button
              type="button"
              className="practice-clear"
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
                className="practice-retry"
                onClick={() => void (privateIdentityError ? session.refetch() : catalog.refetch())}
              >
                Retry
              </button>
            </div>
          ) : catalog.isPending ? (
            <LoadingScreen inline label="Loading questions…" />
          ) : (
            <>
              <CatalogTable
                label="Practice questions"
                heading={
                  <tr>
                    <th
                      scope="col"
                      aria-sort={
                        sort === "title"
                          ? search.order === "desc"
                            ? "descending"
                            : "ascending"
                          : "none"
                      }
                    >
                      <button onClick={() => sortBy("title")}>
                        Question {sort === "title" && <SortIcon size={13} />}
                      </button>
                    </th>
                    <th
                      scope="col"
                      aria-sort={
                        sort === "difficulty"
                          ? search.order === "desc"
                            ? "descending"
                            : "ascending"
                          : "none"
                      }
                    >
                      <button onClick={() => sortBy("difficulty")}>
                        Difficulty {sort === "difficulty" && <SortIcon size={13} />}
                      </button>
                    </th>
                  </tr>
                }
              >
                {catalog.data.items.map((problem) => (
                  <tr
                    key={problem.id}
                    onPointerEnter={warmWorkspacePage}
                    onFocusCapture={warmWorkspacePage}
                    onClick={(event) => {
                      if ((event.target as Element).closest("a, button, input")) return;
                      const href = `/practice/${problem.slug}`;
                      if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
                      else void navigate({ to: "/practice/$slug", params: { slug: problem.slug } });
                    }}
                  >
                    <td>
                      <Link to="/practice/$slug" params={{ slug: problem.slug }}>
                        {problem.title}
                      </Link>
                      <div className="practice-topic-list">
                        {problem.tags.map((tag) => (
                          <button
                            key={tag}
                            onClick={() => update({ topic: addFilter(search.topic, tag) })}
                            aria-label={`Filter by ${label(tag)}`}
                          >
                            {label(tag)}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`practice-difficulty ${problem.difficulty}`}
                        onClick={() =>
                          update({ difficulty: addFilter(search.difficulty, problem.difficulty) })
                        }
                        aria-label={`Filter by ${label(problem.difficulty)}`}
                      >
                        {label(problem.difficulty)}
                      </button>
                    </td>
                  </tr>
                ))}
              </CatalogTable>
              {catalog.data.items.length === 0 && (
                <div className="practice-state">
                  <h2>{filtered ? "No matching questions" : "No questions available"}</h2>
                  <p>
                    {filtered
                      ? "Try another topic or a broader search."
                      : "Check back when new questions are published."}
                  </p>
                  <CatalogFilter
                    label="Companies"
                    selected={filterValues(search.company)}
                    onChange={(values) => update({ company: values.join(",") || undefined })}
                    options={[...new Set([...companies, ...filterValues(search.company)])].map(
                      (value) => ({ value, label: value }),
                    )}
                  />
                  {filtered && (
                    <button className="practice-retry" onClick={clear}>
                      Clear filters
                    </button>
                  )}
                </div>
              )}
              <footer className="practice-pagination">
                <span role="status">
                  {total
                    ? `${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} of ${total}`
                    : "0 questions"}
                </span>
                <div>
                  <button
                    className="practice-page-button"
                    aria-label="Previous page"
                    disabled={page <= 1}
                    onClick={() => update({ page: page - 1 === 1 ? undefined : page - 1 })}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>
                    Page {page} of {pages}
                  </span>
                  <button
                    className="practice-page-button"
                    aria-label="Next page"
                    disabled={page >= pages}
                    onClick={() => update({ page: page + 1 })}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </footer>
            </>
          )}
        </section>
      </CatalogLayout>
    </div>
  );
}
