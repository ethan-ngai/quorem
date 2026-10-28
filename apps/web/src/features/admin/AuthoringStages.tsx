import { initialOdysseySource } from "../odyssey/methodStubs";
import { useEffect, useRef, useState } from "react";
import type { QuestionContent } from "@quorem/contracts";
import { StageAuthoring } from "../odyssey/StageAuthoring";
import { parseStages, type StageDraft } from "../odyssey/stageDrafts";
import { hydrateStages } from "./hydrateStages";

/** Keep incomplete step drafts mounted; only validated typed suites reach saved content. */
export function AuthoringStages({
  content,
  onChange,
  onValidityChange,
}: {
  content: QuestionContent;
  onChange: (content: QuestionContent) => void;
  onValidityChange: (label: string, invalid: boolean) => void;
}) {
  const [stages, setStages] = useState(() => hydrateStages(content));
  const [error, setError] = useState<string>();
  const [invalidTypes, setInvalidTypes] = useState<Record<string, boolean>>({});
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => () => validity.current("stages", false), []);
  function change(next: StageDraft[], types = invalidTypes) {
    setStages(next);
    try {
      if (Object.values(types).some(Boolean)) throw new Error("Fix the highlighted method types.");
      const parsed = parseStages(next, { allowIncomplete: true });
      onChange({
        ...content,
        problem: {
          ...content.problem,
          signature: parsed.odyssey.levels[0]!.methods[0]!,
          odyssey: parsed.odyssey,
        },
        odysseyHiddenCases: parsed.odysseyHiddenCases,
        implementations: content.implementations.map((item) => ({
          ...item,
          starterSource: initialOdysseySource(parsed.odyssey.levels[0]!.methods, item.language),
        })),
      });
      onValidityChange("stages", false);
      setError(undefined);
    } catch (cause) {
      onValidityChange("stages", true);
      setError((cause as Error).message);
    }
  }
  return (
    <>
      <StageAuthoring
        value={stages}
        onChange={change}
        onValidityChange={(id, invalid) => {
          const next = { ...invalidTypes, [id]: invalid };
          setInvalidTypes(next);
          if (invalid || invalidTypes[id]) change(stages, next);
        }}
      />
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
