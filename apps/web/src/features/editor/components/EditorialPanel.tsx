/** @file EditorialPanel.tsx @description Opt-in authored complexity and solutions. @module editor */
import { selectEditorial } from "@quorem/questions";
import { userFacingErrorMessage } from "../../../ui/errors";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, EditorialSolution } from "@quorem/contracts";
import { api, requireData } from "../../../api/client";
import { StatementMarkdown, inlineStatement } from "./StatementMarkdown";
import { Braces, Clock3 } from "lucide-react";
import { EditorialCode } from "./EditorialCode";
import { solutionLanguageLabel } from "../editorLanguages";
import type { EditorTheme } from "../PythonEditor";
import type { EditorScheme } from "../editorSchemes";
import { complexityMath, complexityNotesMarkup } from "../complexityMarkup";
import "./editorial.css";

type Complexity = Pick<
  EditorialSolution,
  "language" | "timeComplexity" | "spaceComplexity" | "complexityNotes"
>;
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
  theme,
  colorScheme,
  language = "python",
  inMatch = false,
  available = true,
  solutionAvailable = false,
}: {
  identity: DevelopmentIdentity;
  versionId: string;
  theme: EditorTheme;
  colorScheme: EditorScheme;
  language?: string;
  inMatch?: boolean;
  available?: boolean;
  solutionAvailable?: boolean;
}) {
  const [active, setActive] = useState<"complexity" | "solution" | null>(null);
  const [displayed, setDisplayed] = useState<"complexity" | "solution" | null>(null);
  function toggle(item: "complexity" | "solution") {
    if (active === item) setActive(null);
    else {
      setDisplayed(item);
      setActive(item);
    }
  }
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
  const selectedComplexity = selectEditorial(complexity.data, language);
  const selectedSolution = selectEditorial(solutions.data, language);
  const visible = active === "complexity" ? available : active === "solution" && solutionAvailable;
  return (
    <section className="editorial-section" aria-label="Question guidance" data-open={!!visible}>
      <div className="editorial-controls">
        {available && (
          <button
            className="topics-toggle"
            aria-label={active === "complexity" ? "Hide complexity" : "Show complexity"}
            aria-expanded={active === "complexity"}
            onClick={() => toggle("complexity")}
          >
            <Clock3 aria-hidden="true" /> Complexity
          </button>
        )}
        {solutionAvailable && (
          <button
            className="topics-toggle"
            aria-label={active === "solution" ? "Hide solution" : "Show solution"}
            aria-expanded={active === "solution"}
            onClick={() => toggle("solution")}
          >
            <Braces aria-hidden="true" /> Solution
          </button>
        )}
      </div>
      {displayed && (available || solutionAvailable) && (
        <div
          key={displayed}
          className="editorial-content"
          data-visible={!!visible}
          aria-hidden={!visible}
          inert={!visible}
          onAnimationEnd={() => {
            if (!visible) setDisplayed(null);
          }}
        >
          {displayed === "complexity" ? (
            complexity.isPending ? (
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
              <p>No published complexity for {language}.</p>
            )
          ) : solutions.isPending ? (
            <p role="status">Loading solution…</p>
          ) : solutions.isError ? (
            <p role="alert">
              {userFacingErrorMessage(solutions.error, "Solution unavailable. Please try again.")}
            </p>
          ) : selectedSolution ? (
            <>
              <p>{solutionLanguageLabel(selectedSolution.language)} solution</p>
              {selectedSolution.explanationMarkdown && (
                <StatementMarkdown source={selectedSolution.explanationMarkdown} />
              )}
              <EditorialCode
                source={selectedSolution.source}
                language={selectedSolution.language}
                theme={theme}
                colorScheme={colorScheme}
              />
            </>
          ) : (
            <p>No published solution for {language}.</p>
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
