/** @file PracticeBrowser.tsx @description Public question catalog with local filtering and sorting. @module practice */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useState } from "react";
import type { ProblemVersion } from "@quorem/contracts";
import { api, requireData } from "../editor/api";
import { Tooltip } from "../editor/components/Tooltip";
import { useTheme } from "../editor/useTheme";
import { useAccountIdentity } from "../matches/MatchControls";
import { GlobalNav } from "../navigation/GlobalNav";
import { SelectField } from "../../ui/SelectField";
import "../../styles/workspace.css";
import "./practice.css";

type Sort = "title" | "difficulty";
const difficultyOrder = { easy: 0, medium: 1, hard: 2 };
const label = (value: string) =>
  value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

/** @returns Matching questions in deterministic title or difficulty order. */
export function filterProblems(
  problems: ProblemVersion[],
  search: string,
  difficulty: string,
  topic: string,
  sort: Sort,
  descending: boolean,
) {
  const query = search.trim().toLowerCase();
  return problems
    .filter(
      (problem) =>
        (!query ||
          `${problem.title} ${problem.slug} ${problem.tags.join(" ")}`
            .toLowerCase()
            .includes(query)) &&
        (difficulty === "all" || problem.difficulty === difficulty) &&
        (topic === "all" || problem.tags.includes(topic)),
    )
    .sort((a, b) => {
      const order =
        sort === "difficulty" ? difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty] : 0;
      const comparison = order || a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug);
      return descending ? -comparison : comparison;
    });
}

/** @returns Searchable public catalog; request failures retain explicit retry. */
export function PracticeBrowser() {
  const { identity } = useAccountIdentity();
  const { preference, setPreference } = useTheme();
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState("all");
  const [topic, setTopic] = useState("all");
  const [sort, setSort] = useState<Sort>("title");
  const [descending, setDescending] = useState(false);
  const catalog = useQuery({
    queryKey: ["public-problems", identity],
    queryFn: async () => {
      const { data, error } = await api(identity).GET("/v1/problems");
      return requireData(data, error);
    },
    staleTime: 60_000,
  });
  const problems = catalog.data?.items ?? [];
  const topics = [...new Set(problems.flatMap((problem) => problem.tags))].sort();
  const visible = filterProblems(problems, search, difficulty, topic, sort, descending);
  const filtered = search !== "" || difficulty !== "all" || topic !== "all";
  const clear = () => {
    setSearch("");
    setDifficulty("all");
    setTopic("all");
  };
  const sortBy = (next: Sort) => {
    setSort(next);
    setDescending(next === sort ? !descending : false);
  };
  const SortIcon = descending ? ArrowDown : ArrowUp;
  return (
    <div className="practice-page">
      <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />
      <main className="practice-browser">
        <div className="practice-heading">
          <h1>Practice</h1>
          {catalog.data && <span>{problems.length} questions</span>}
        </div>
        <div className="practice-toolbar">
          <label className="practice-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search questions"
              placeholder="Search questions"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <SelectField
            className="select-field--filter"
            label="Difficulty"
            value={difficulty}
            onChange={setDifficulty}
            options={[
              { value: "all", label: "All difficulties" },
              ...Object.keys(difficultyOrder).map((value) => ({ value, label: label(value) })),
            ]}
          />
          {topics.length > 0 && (
            <SelectField
              className="select-field--filter"
              label="Topic"
              value={topic}
              onChange={setTopic}
              options={[
                { value: "all", label: "All topics" },
                ...topics.map((value) => ({ value, label: label(value) })),
              ]}
            />
          )}
          {filtered && (
            <Tooltip content="Clear filters">
              <button
                type="button"
                className="practice-clear"
                aria-label="Clear filters"
                onClick={clear}
              >
                <X size={16} />
              </button>
            </Tooltip>
          )}
        </div>
        {catalog.isPending ? (
          <div className="practice-state" role="status">
            Loading questions…
          </div>
        ) : catalog.isError ? (
          <div className="practice-state" role="alert">
            <p>{catalog.error.message}</p>
            <button className="practice-retry" onClick={() => void catalog.refetch()}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="practice-count" role="status">
              {filtered ? `${visible.length} of ${problems.length} questions` : "All questions"}
            </div>
            <table className="practice-table">
              <caption className="sr-only">Practice questions</caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    aria-sort={
                      sort === "title" ? (descending ? "descending" : "ascending") : "none"
                    }
                  >
                    <button onClick={() => sortBy("title")}>
                      Question {sort === "title" && <SortIcon size={13} />}
                    </button>
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sort === "difficulty" ? (descending ? "descending" : "ascending") : "none"
                    }
                  >
                    <button onClick={() => sortBy("difficulty")}>
                      Difficulty {sort === "difficulty" && <SortIcon size={13} />}
                    </button>
                  </th>
                  <th scope="col" className="practice-topics-column">
                    Topics
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((problem) => (
                  <tr key={problem.id}>
                    <td>
                      <Link to="/practice/$slug" params={{ slug: problem.slug }}>
                        {problem.title}
                      </Link>
                      <span className="practice-mobile-topics">
                        {problem.tags.map(label).join(" · ")}
                      </span>
                    </td>
                    <td>
                      <span className={`practice-difficulty ${problem.difficulty}`}>
                        {label(problem.difficulty)}
                      </span>
                    </td>
                    <td className="practice-topics-column">
                      <div className="practice-topic-list">
                        {problem.tags.map((tag) => (
                          <button
                            key={tag}
                            onClick={() => setTopic(tag)}
                            aria-label={`Filter by ${label(tag)}`}
                          >
                            {label(tag)}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && (
              <div className="practice-state">
                <p>{filtered ? "No questions match these filters." : "No questions available."}</p>
                {filtered && (
                  <button className="practice-retry" onClick={clear}>
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
