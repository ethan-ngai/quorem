import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, requireData } from "../editor/api";
import { useTheme } from "../editor/useTheme";
import { useAccountIdentity } from "../matches/MatchControls";
import { GlobalNav } from "../navigation/GlobalNav";
import { CatalogFilter } from "./CatalogFilter";
import { addFilter, filterValues } from "./catalogSearch";
import type { CatalogSearch } from "./catalogSearch";
import "../../styles/workspace.css";
import "./practice.css";

const label = (value: string) =>
  value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const pageSize = 20;

export function PracticeBrowser() {
  const { identity } = useAccountIdentity();
  const { preference, setPreference } = useTheme();
  const search = useSearch({ from: "/practice" });
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
  const catalog = useQuery({
    queryKey: [
      "public-problems",
      search.q,
      search.difficulty,
      search.topic,
      search.sort,
      search.order,
      search.page,
    ],
    queryFn: async ({ signal }) => {
      const { data, error } = await api().GET("/v1/problems", {
        params: {
          query: {
            q: search.q,
            difficulty: search.difficulty,
            topic: search.topic,
            sort: search.sort,
            order: search.order,
            page: search.page ?? 1,
            limit: pageSize,
          },
        },
        signal,
      });
      return requireData(data, error);
    },
    staleTime: 30_000,
  });
  // Filter options use a separate cache, so changing filters never removes available topics.
  const metadata = useQuery({
    queryKey: ["public-problem-topics"],
    queryFn: async ({ signal }) => {
      const { data, error } = await api().GET("/v1/problems", {
        params: { query: { limit: 1 } },
        signal,
      });
      return requireData(data, error).topics;
    },
    staleTime: 60_000,
  });
  const topics = metadata.data ?? catalog.data?.topics ?? [];
  const filtered = Boolean(search.q || search.difficulty || search.topic);
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
    update({ q: undefined, difficulty: undefined, topic: undefined });
  };
  const page = search.page ?? 1;
  const total = catalog.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (catalog.data && !catalog.isFetching && page > pages)
      update({ page: pages === 1 ? undefined : pages }, true);
  }, [catalog.data, catalog.isFetching, page, pages]);
  return (
    <div className="practice-page">
      <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />
      <main className="practice-browser">
        <header className="practice-heading">
          <div>
            <h1>Practice</h1>
            <p>Browse questions by topic and difficulty.</p>
          </div>
          {catalog.data && (
            <span className="practice-total">
              {total} {total === 1 ? "question" : "questions"}
            </span>
          )}
        </header>
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
        {(search.difficulty || search.topic) && (
          <div className="practice-active-filters" aria-label="Active filters">
            {(["difficulty", "topic"] as const).flatMap((category) =>
              filterValues(search[category]).map((value) => (
                <button
                  key={`${category}:${value}`}
                  type="button"
                  aria-label={`Remove ${label(value)} filter`}
                  onClick={() =>
                    update({
                      [category]:
                        filterValues(search[category])
                          .filter((item) => item !== value)
                          .join(",") || undefined,
                    })
                  }
                >
                  {label(value)}
                  <X size={12} aria-hidden="true" />
                </button>
              )),
            )}
          </div>
        )}
        <section
          className="practice-catalog"
          aria-label="Practice questions"
          aria-busy={catalog.isFetching}
        >
          {catalog.isPending ? (
            <div className="practice-state" role="status">
              Loading questions…
            </div>
          ) : catalog.isError ? (
            <div className="practice-state" role="alert">
              <p>Questions couldn’t load. {catalog.error.message}</p>
              <button className="practice-retry" onClick={() => void catalog.refetch()}>
                Retry
              </button>
            </div>
          ) : (
            <>
              <table className="practice-table">
                <caption className="sr-only">Practice questions</caption>
                <thead>
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
                    <th scope="col" className="practice-language-column">
                      Languages
                    </th>
                    <th scope="col">
                      <span className="sr-only">Open question</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.data.items.map((problem) => (
                    <tr
                      key={problem.id}
                      onClick={(event) => {
                        if ((event.target as Element).closest("a, button, input")) return;
                        const href = `/practice/${problem.slug}`;
                        if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
                        else
                          void navigate({ to: "/practice/$slug", params: { slug: problem.slug } });
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
                      <td className="practice-language-column">
                        <span>
                          {(problem.languages ?? [])
                            .map((item) =>
                              label(
                                item.language === "typescript"
                                  ? "TypeScript"
                                  : item.language === "ocaml"
                                    ? "OCaml"
                                    : item.language,
                              ),
                            )
                            .join(" · ")}
                        </span>
                      </td>
                      <td>
                        <Link
                          className="practice-open"
                          to="/practice/$slug"
                          params={{ slug: problem.slug }}
                          aria-label={`Open ${problem.title}`}
                        >
                          <ChevronRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {catalog.data.items.length === 0 && (
                <div className="practice-state">
                  <h2>{filtered ? "No matching questions" : "No questions available"}</h2>
                  <p>
                    {filtered
                      ? "Try another topic or a broader search."
                      : "Check back when new questions are published."}
                  </p>
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
      </main>
    </div>
  );
}
