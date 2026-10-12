/** @file EditorialPanel.tsx @description Explicit editorial and complexity disclosure. @module editor */
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, EditorialSolution } from "@quorem/contracts";
import { api, requireData } from "../api";
import { StatementMarkdown } from "./StatementMarkdown";
import "./editorial.css";

type Complexity = Pick<
  EditorialSolution,
  "language" | "timeComplexity" | "spaceComplexity" | "complexityNotes"
>;
const labels: Record<string, string> = {
  python: "Python",
  java: "Java",
  typescript: "TypeScript",
  ocaml: "OCaml",
};

/** @returns Only authored complexity; source is fetched separately after opening solutions. */
async function loadComplexity(identity: DevelopmentIdentity, id: string) {
  const { data, error } = await api(identity).GET("/v1/problem-versions/{id}/complexity", {
    params: { path: { id } },
  });
  return requireData(data, error).items;
}

/** @returns Published editorial code; never private judge references. */
async function loadSolutions(identity: DevelopmentIdentity, id: string) {
  const { data, error } = await api(identity).GET("/v1/problem-versions/{id}/solutions", {
    params: { path: { id } },
  });
  return requireData(data, error).items;
}

/** Resets disclosure when its keyed immutable problem changes. */
export function EditorialPanel({
  identity,
  versionId,
  language = "python",
  inMatch = false,
}: {
  identity: DevelopmentIdentity;
  versionId: string;
  language?: string;
  inMatch?: boolean;
}) {
  const [complexityOpen, setComplexityOpen] = useState(false);
  const [solutionsOpen, setSolutionsOpen] = useState(false);
  const [chosenLanguage, setChosenLanguage] = useState<string>();
  const desiredLanguage = chosenLanguage ?? language;
  const regionId = useId();
  const complexity = useQuery({
    queryKey: ["complexity", identity, versionId],
    queryFn: () => loadComplexity(identity, versionId),
    enabled: complexityOpen && !inMatch,
    retry: false,
  });
  const solutions = useQuery({
    queryKey: ["solutions", identity, versionId],
    queryFn: () => loadSolutions(identity, versionId),
    enabled: solutionsOpen && !inMatch,
    retry: false,
  });
  const selected = solutions.data?.find((item) => item.language === desiredLanguage);
  const selectedComplexity = complexity.data?.find((item) => item.language === language);
  if (inMatch) return null;
  return (
    <section className="editorial-section" aria-label="Editorial">
      <div className="editorial-actions">
        <button
          className="quiet-button"
          aria-expanded={complexityOpen}
          aria-controls={`${regionId}-complexity`}
          onClick={() => setComplexityOpen(!complexityOpen)}
        >
          {complexityOpen ? "Hide" : "Show"} complexity
        </button>
        <button
          className="quiet-button"
          aria-expanded={solutionsOpen}
          aria-controls={`${regionId}-solutions`}
          onClick={() => setSolutionsOpen(!solutionsOpen)}
        >
          {solutionsOpen ? "Hide" : "Show"} solutions
        </button>
      </div>
      {complexityOpen && (
        <div id={`${regionId}-complexity`}>
          {complexity.isPending ? (
            <p role="status">Loading complexity…</p>
          ) : complexity.isError ? (
            <p role="alert">{complexity.error.message}</p>
          ) : selectedComplexity ? (
            <ComplexityDetails value={selectedComplexity} />
          ) : (
            <p>No published complexity for {labels[language] ?? language}.</p>
          )}
        </div>
      )}
      {solutionsOpen && (
        <div id={`${regionId}-solutions`} className="editorial-solution">
          <h2>Solutions</h2>
          {solutions.isPending ? (
            <p role="status">Loading solutions…</p>
          ) : solutions.isError ? (
            <p role="alert">{solutions.error.message}</p>
          ) : !solutions.data?.length ? (
            <p>No published solutions yet.</p>
          ) : (
            <>
              <label className="editorial-language">
                Solution language
                <select
                  value={desiredLanguage}
                  onChange={(event) => setChosenLanguage(event.target.value)}
                >
                  {!solutions.data.some((item) => item.language === desiredLanguage) && (
                    <option value={desiredLanguage}>
                      {labels[desiredLanguage] ?? desiredLanguage} — unavailable
                    </option>
                  )}
                  {solutions.data.map((item) => (
                    <option key={item.language} value={item.language}>
                      {labels[item.language] ?? item.language}
                    </option>
                  ))}
                </select>
              </label>
              {selected ? (
                <>
                  <StatementMarkdown source={selected.explanationMarkdown} />
                  <pre
                    className="editorial-source"
                    tabIndex={0}
                    aria-label={`${labels[selected.language] ?? selected.language} solution`}
                  >
                    <code>{selected.source}</code>
                  </pre>
                  <ComplexityDisclosure value={selected} />
                </>
              ) : (
                <p>No solution in this language. Choose an available language above.</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** @returns Author-provided asymptotic costs and variable definitions. */
function ComplexityDetails({ value }: { value: Complexity }) {
  return (
    <div className="editorial-complexity">
      <dl>
        <div>
          <dt>Time</dt>
          <dd>
            <code>{value.timeComplexity}</code>
          </dd>
        </div>
        <div>
          <dt>Auxiliary space</dt>
          <dd>
            <code>{value.spaceComplexity}</code>
          </dd>
        </div>
      </dl>
      {value.complexityNotes && <StatementMarkdown source={value.complexityNotes} />}
    </div>
  );
}

/** Uses a language key so revealing one solution never reveals another's costs. */
function ComplexityDisclosure({ value }: { value: Complexity }) {
  return (
    <details key={value.language} className="editorial-disclosure">
      <summary>Complexity</summary>
      <ComplexityDetails value={value} />
    </details>
  );
}
