/** @file EditorialPanel.tsx @description Opt-in authored complexity; solutions are deferred. @module editor */
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, EditorialSolution } from "@quorem/contracts";
import { api, requireData } from "../api";
import { StatementMarkdown, inlineStatement } from "./StatementMarkdown";
import { VisibilityIcon } from "./Icon";
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
}: {
  identity: DevelopmentIdentity;
  versionId: string;
  language?: string;
  inMatch?: boolean;
}) {
  const [complexityOpen, setComplexityOpen] = useState(false);
  const regionId = useId();
  const complexity = useQuery({
    queryKey: ["complexity", identity, versionId],
    queryFn: () => loadComplexity(identity, versionId),
    enabled: complexityOpen && !inMatch,
    retry: false,
  });
  const selected = complexity.data?.find((item) => item.language === language);
  if (inMatch) return null;
  return (
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
            <p role="alert">{complexity.error.message}</p>
          ) : selected ? (
            <ComplexityDetails value={selected} />
          ) : (
            <p>No published complexity for {labels[language] ?? language}.</p>
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
