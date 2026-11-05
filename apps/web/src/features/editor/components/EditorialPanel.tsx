/** @file EditorialPanel.tsx @description Opt-in authored complexity and solutions. @module editor */
import { selectApproach, approachCode } from "@quorem/questions";
import { userFacingErrorMessage } from "../../../ui/errors";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, ApproachComplexity } from "@quorem/contracts";
import { api, requireData } from "../../../api/client";
import { StatementMarkdown, inlineStatement } from "./StatementMarkdown";
import { Braces, Clock3 } from "lucide-react";
import { ApproachPicker } from "./ApproachPicker";
import { EditorialCode } from "./EditorialCode";
import { solutionLanguageLabel } from "../editorLanguages";
import type { EditorTheme } from "../PythonEditor";
import type { EditorScheme } from "../editorSchemes";
import { complexityMath, complexityNotesMarkup } from "../complexityMarkup";
import "./editorial.css";

type Complexity = Pick<
  ApproachComplexity,
  "timeComplexity" | "spaceComplexity" | "complexityNotes"
>;
/** Complexity is separate from published solution source. */
async function loadComplexity(identity: DevelopmentIdentity, id: string) {
  const { data, error } = await api(identity).GET("/v1/problem-versions/{id}/complexity", {
    params: { path: { id } },
  });
  return requireData(data, error);
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
  const [selectedId, setSelectedId] = useState<string>();
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
    queryKey: ["complexity", "approaches", identity, versionId],
    queryFn: () => loadComplexity(identity, versionId),
    enabled: !inMatch && available,
    staleTime: Infinity,
    retry: false,
  });
  const solutions = useQuery({
    queryKey: ["solutions", "approaches", identity, versionId],
    queryFn: async () => {
      const { data, error } = await api(identity).GET("/v1/problem-versions/{id}/solutions", {
        params: { path: { id: versionId } },
      });
      return requireData(data, error);
    },
    enabled: !inMatch && solutionAvailable,
    staleTime: Infinity,
    retry: false,
  });
  if (inMatch || (!available && !solutionAvailable)) return null;
  const selectedComplexity = selectApproach(
    complexity.data?.items,
    selectedId,
    complexity.data?.canonicalApproachId ?? "",
  );
  const selectedSolution = selectApproach(
    solutions.data?.items,
    selectedId,
    solutions.data?.canonicalApproachId ?? "",
  );
  const selectedCode = selectedSolution && approachCode(selectedSolution, language);
  const choices = displayed === "complexity" ? complexity.data : solutions.data;
  const selected = displayed === "complexity" ? selectedComplexity : selectedSolution;
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
          {choices && choices.items.length > 1 && selected && (
            <ApproachPicker
              approaches={choices.items}
              canonicalId={choices.canonicalApproachId}
              selectedId={selected.id}
              onChange={setSelectedId}
            />
          )}
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
              <p>No published complexity.</p>
            )
          ) : solutions.isPending ? (
            <p role="status">Loading solution…</p>
          ) : solutions.isError ? (
            <p role="alert">
              {userFacingErrorMessage(solutions.error, "Solution unavailable. Please try again.")}
            </p>
          ) : selectedSolution && selectedCode ? (
            <>
              <p>{solutionLanguageLabel(selectedCode.language)} solution</p>
              {selectedSolution.explanationMarkdown && (
                <StatementMarkdown source={selectedSolution.explanationMarkdown} />
              )}
              <EditorialCode
                source={selectedCode.source}
                language={selectedCode.language}
                theme={theme}
                colorScheme={colorScheme}
              />
              {(selectedSolution.timeComplexity ||
                selectedSolution.spaceComplexity ||
                selectedSolution.complexityNotes) && <ComplexityDetails value={selectedSolution} />}
            </>
          ) : (
            <p>No published solution.</p>
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
          <dd>
            {value.timeComplexity
              ? inlineStatement(complexityMath(value.timeComplexity))
              : "Not specified"}
          </dd>
        </div>
        <div>
          <dt>Auxiliary space</dt>
          <dd>
            {value.spaceComplexity
              ? inlineStatement(complexityMath(value.spaceComplexity))
              : "Not specified"}
          </dd>
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
