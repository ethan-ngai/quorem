/** @file EditorialPanel.tsx @description Opt-in authored complexity and solutions. @module editor */
import { selectApproach } from "@quorem/questions";
import { userFacingErrorMessage } from "../../../ui/errors";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity } from "@quorem/contracts";
import { api, requireData } from "../../../api/client";
import { Braces, Clock3 } from "lucide-react";
import { ApproachPicker } from "./ApproachPicker";
import { SolutionDisplay } from "./SolutionDisplay";
import { ComplexityDetails } from "./ComplexityDetails";
import type { EditorTheme } from "../PythonEditor";
import type { EditorScheme } from "../editorSchemes";
import "./editorial.css";
import { LoadingIndicator } from "../../../ui/Spinner";

/** Complexity is separate from published solution source. */
async function loadComplexity(identity: DevelopmentIdentity, id: string) {
  const { data, error } = await api(identity).GET("/v1/question-publications/{id}/complexity", {
    params: { path: { id } },
  });
  return requireData(data, error);
}

export type EditorialComplexity = Awaited<ReturnType<typeof loadComplexity>>;

export function EditorialPanel({
  identity,
  versionId,
  theme,
  colorScheme,
  language = "python",
  inMatch = false,
  available = true,
  solutionAvailable = false,
  requestComplexity,
  complexityDisabled = false,
}: {
  identity: DevelopmentIdentity;
  versionId: string;
  theme: EditorTheme;
  colorScheme: EditorScheme;
  language?: string;
  inMatch?: boolean;
  available?: boolean;
  solutionAvailable?: boolean;
  requestComplexity?: (
    anchor: HTMLButtonElement,
    open: (value: EditorialComplexity) => void,
  ) => void;
  complexityDisabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [active, setActive] = useState<"complexity" | "solution" | null>(null);
  const [displayed, setDisplayed] = useState<"complexity" | "solution" | null>(null);
  const [grantedComplexity, setGrantedComplexity] = useState<EditorialComplexity>();
  function open(item: "complexity" | "solution") {
    setDisplayed(item);
    setActive(item);
  }
  function toggle(item: "complexity" | "solution", anchor: HTMLButtonElement) {
    if (active === item) setActive(null);
    else if (item === "complexity" && requestComplexity && !grantedComplexity) {
      if (complexityDisabled) return;
      requestComplexity(anchor, (value) => {
        setGrantedComplexity(value);
        open(item);
      });
    } else open(item);
  }
  const complexity = useQuery({
    queryKey: ["complexity", "approaches", identity, versionId],
    queryFn: () => loadComplexity(identity, versionId),
    enabled: !inMatch && !requestComplexity && available,
    staleTime: Infinity,
    retry: false,
  });
  const solutions = useQuery({
    queryKey: ["solutions", "approaches", identity, versionId],
    queryFn: async () => {
      const { data, error } = await api(identity).GET("/v1/question-publications/{id}/solutions", {
        params: { path: { id: versionId } },
      });
      return requireData(data, error);
    },
    enabled: !inMatch && solutionAvailable,
    staleTime: Infinity,
    retry: false,
  });
  if ((inMatch && !requestComplexity) || (!available && !solutionAvailable)) return null;
  const complexityData = requestComplexity ? grantedComplexity : complexity.data;
  const selectedComplexity = selectApproach(
    complexityData?.items,
    selectedId,
    complexityData?.canonicalApproachId ?? "",
  );
  const visible = active === "complexity" ? available : active === "solution" && solutionAvailable;
  return (
    <section className="editorial-section" aria-label="Question guidance" data-open={!!visible}>
      <div className="editorial-controls">
        {available && (
          <button
            className="topics-toggle"
            aria-label={active === "complexity" ? "Hide complexity" : "Show complexity"}
            aria-expanded={active === "complexity"}
            aria-disabled={!!requestComplexity && !grantedComplexity && complexityDisabled}
            aria-haspopup={requestComplexity && !grantedComplexity ? "dialog" : undefined}
            onClick={(event) => toggle("complexity", event.currentTarget)}
          >
            <Clock3 aria-hidden="true" /> Complexity
          </button>
        )}
        {solutionAvailable && (
          <button
            className="topics-toggle"
            aria-label={active === "solution" ? "Hide solution" : "Show solution"}
            aria-expanded={active === "solution"}
            onClick={(event) => toggle("solution", event.currentTarget)}
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
          {displayed === "complexity" &&
            complexityData &&
            complexityData.items.length > 1 &&
            selectedComplexity && (
              <ApproachPicker
                approaches={complexityData.items}
                canonicalId={complexityData.canonicalApproachId}
                selectedId={selectedComplexity.id}
                onChange={setSelectedId}
              />
            )}
          {displayed === "complexity" ? (
            !requestComplexity && complexity.isPending ? (
              <LoadingIndicator label="Loading complexity…" />
            ) : !requestComplexity && complexity.isError ? (
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
            <LoadingIndicator label="Loading solution…" />
          ) : solutions.isError ? (
            <p role="alert">
              {userFacingErrorMessage(solutions.error, "Solution unavailable. Please try again.")}
            </p>
          ) : solutions.data?.items.length ? (
            <SolutionDisplay
              approaches={solutions.data.items}
              canonicalApproachId={solutions.data.canonicalApproachId}
              selectedId={selectedId}
              onApproachChange={setSelectedId}
              preferredLanguage={language}
              theme={theme}
              colorScheme={colorScheme}
            />
          ) : (
            <p>No published solution.</p>
          )}
        </div>
      )}
    </section>
  );
}
