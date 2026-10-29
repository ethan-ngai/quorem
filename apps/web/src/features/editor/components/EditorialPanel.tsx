/** @file EditorialPanel.tsx @description Opt-in authored complexity and solutions. @module editor */
import { userFacingErrorMessage } from "../../../ui/errors";
import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, EditorialSolution } from "@quorem/contracts";
import { api, requireData } from "../../../api/client";
import { StatementMarkdown, inlineStatement } from "./StatementMarkdown";
import { ChevronDown } from "lucide-react";
import { complexityMath, complexityNotesMarkup } from "../complexityMarkup";
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

/** Complexity is separate from published solution source. */
async function loadComplexity(identity: DevelopmentIdentity, id: string) {
  const { data, error } = await api(identity).GET("/v1/problem-versions/{id}/complexity", {
    params: { path: { id } },
  });
  return requireData(data, error).items;
}

export function EditorialPanel({
  identity,
  versionId,
  language = "python",
  inMatch = false,
  available = true,
  solutionAvailable = false,
}: {
  identity: DevelopmentIdentity;
  versionId: string;
  language?: string;
  inMatch?: boolean;
  available?: boolean;
  solutionAvailable?: boolean;
}) {
  const complexity = useQuery({
    queryKey: ["complexity", identity, versionId],
    queryFn: () => loadComplexity(identity, versionId),
    enabled: !inMatch && available,
    staleTime: Infinity,
    retry: false,
  });
  const solutions = useQuery({
    queryKey: ["solutions", identity, versionId],
    queryFn: async () => {
      const { data, error } = await api(identity).GET("/v1/problem-versions/{id}/solutions", {
        params: { path: { id: versionId } },
      });
      return requireData(data, error).items;
    },
    enabled: !inMatch && solutionAvailable,
    staleTime: Infinity,
    retry: false,
  });
  if (inMatch || (!available && !solutionAvailable)) return null;
  const selectedComplexity = complexity.data?.find((item) => item.language === language);
  const selectedSolution = solutions.data?.find((item) => item.language === language);
  return (
    <section className="editorial-section" aria-label="Question guidance">
      {available && (
        <details className="editorial-disclosure">
          <summary>
            Complexity <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className="editorial-content">
            {complexity.isPending ? (
              <p role="status">Loading complexity…</p>
            ) : complexity.isError ? (
              <p role="alert">
                {userFacingErrorMessage(
                  complexity.error,
                  "Complexity unavailable. Please try again.",
                )}
              </p>
            ) : selectedComplexity ? (
              <ComplexityDetails value={selectedComplexity} />
            ) : (
              <p>No published complexity for {labels[language] ?? language}.</p>
            )}
          </div>
        </details>
      )}
      {solutionAvailable && (
        <details className="editorial-disclosure">
          <summary>
            Solution <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className="editorial-content">
            {solutions.isPending ? (
              <p role="status">Loading solution…</p>
            ) : solutions.isError ? (
              <p role="alert">
                {userFacingErrorMessage(solutions.error, "Solution unavailable. Please try again.")}
              </p>
            ) : selectedSolution ? (
              <>
                {selectedSolution.explanationMarkdown && (
                  <StatementMarkdown source={selectedSolution.explanationMarkdown} />
                )}
                <pre className="editorial-source">
                  <code>{selectedSolution.source}</code>
                </pre>
              </>
            ) : (
              <p>No published solution for {labels[language] ?? language}.</p>
            )}
          </div>
        </details>
      )}
    </section>
  );
}

export function ComplexityDetails({ value }: { value: Complexity }) {
  return (
    <div className="editorial-complexity">
      <dl>
        <div>
          <dt>Time</dt>
          <dd>{inlineStatement(complexityMath(value.timeComplexity))}</dd>
        </div>
        <div>
          <dt>Auxiliary space</dt>
          <dd>{inlineStatement(complexityMath(value.spaceComplexity))}</dd>
        </div>
      </dl>
      {value.complexityNotes && (
        <StatementMarkdown
          source={complexityNotesMarkup(
            value.complexityNotes,
            value.timeComplexity,
            value.spaceComplexity,
          )}
        />
      )}
    </div>
  );
}
