/** @file EditorialPanel.tsx @description Opt-in authored complexity and solutions. @module editor */
import { userFacingErrorMessage } from "../../../ui/errors";
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, EditorialSolution } from "@quorem/contracts";
import { api, requireData } from "../../../api/client";
import { StatementMarkdown, inlineStatement } from "./StatementMarkdown";
import { VisibilityIcon } from "../../../ui/Icon";
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

/** Costs load only after disclosure; the response contains no solution source. */
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
  const [complexityOpen, setComplexityOpen] = useState(false);
  const regionId = useId();
  const complexity = useQuery({
    queryKey: ["complexity", identity, versionId],
    queryFn: () => loadComplexity(identity, versionId),
    enabled: complexityOpen && !inMatch && available,
    retry: false,
  });
  const selected = complexity.data?.find((item) => item.language === language);
  if (inMatch || (!available && !solutionAvailable)) return null;
  return (
    <>
      {available && (
        <section className="editorial-section" aria-label="Complexity">
          <button
            className="topics-toggle"
            aria-label={complexityOpen ? "Hide complexity" : "Show complexity"}
            aria-expanded={complexityOpen}
            aria-controls={regionId}
            onClick={() => setComplexityOpen(!complexityOpen)}
          >
            <VisibilityIcon visible={complexityOpen} />
            Complexity
          </button>
          {complexityOpen && (
            <div id={regionId}>
              {complexity.isPending ? (
                <p role="status">Loading complexity…</p>
              ) : complexity.isError ? (
                <p role="alert">
                  {userFacingErrorMessage(
                    complexity.error,
                    "Complexity unavailable. Please try again.",
                  )}
                </p>
              ) : selected ? (
                <ComplexityDetails value={selected} />
              ) : (
                <p>No published complexity for {labels[language] ?? language}.</p>
              )}
            </div>
          )}
        </section>
      )}
      {solutionAvailable && (
        <SolutionDisclosure identity={identity} versionId={versionId} language={language} />
      )}
    </>
  );
}

export function SolutionDisclosure({
  identity,
  versionId,
  language,
}: {
  identity: DevelopmentIdentity;
  versionId: string;
  language: string;
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const solutions = useQuery({
    queryKey: ["solutions", identity, versionId],
    queryFn: async () => {
      const { data, error } = await api(identity).GET("/v1/problem-versions/{id}/solutions", {
        params: { path: { id: versionId } },
      });
      return requireData(data, error).items;
    },
    enabled: open,
    retry: false,
  });
  const selected = solutions.data?.find((item) => item.language === language);
  return (
    <section className="editorial-section" aria-label="Solution">
      <button
        className="topics-toggle"
        aria-label={open ? "Hide solution" : "Show solution"}
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen(!open)}
      >
        <VisibilityIcon visible={open} /> Solution
      </button>
      {open && (
        <div id={regionId}>
          {solutions.isPending ? (
            <p role="status">Loading solution…</p>
          ) : solutions.isError ? (
            <p role="alert">
              {userFacingErrorMessage(solutions.error, "Solution unavailable. Please try again.")}
            </p>
          ) : selected ? (
            <>
              {selected.explanationMarkdown && (
                <StatementMarkdown source={selected.explanationMarkdown} />
              )}
              <pre className="editorial-source">
                <code>{selected.source}</code>
              </pre>
            </>
          ) : (
            <p>No published solution for {labels[language] ?? language}.</p>
          )}
        </div>
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
