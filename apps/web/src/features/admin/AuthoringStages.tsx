import { authoringIssue } from "./authoringValidation";
import type { ReportAuthoringValidity } from "./authoringValidation";
import { NoticeRegion } from "../../ui/PersistentNotice";
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
  onValidityChange: ReportAuthoringValidity;
}) {
  const [stages, setStages] = useState(() => hydrateStages(content));
  const [error, setError] = useState<string>();
  const [invalidTypes, setInvalidTypes] = useState<Record<string, boolean>>({});
  const validity = useRef(onValidityChange);
  validity.current = onValidityChange;
  useEffect(() => () => validity.current("stages", false), []);
  useEffect(() => {
    try {
      if (Object.values(invalidTypes).some(Boolean))
        throw new Error("Fix the highlighted method types.");
      parseStages(stages, { allowIncomplete: true, constraints: content.problem.constraints });
      validity.current("stages", false);
      setError(undefined);
    } catch (cause) {
      validity.current("stages", true, [authoringIssue(cause, "Steps")]);
      setError((cause as Error).message);
    }
  }, [stages, invalidTypes, content.problem.constraints]);
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
      parseStages(next, { allowIncomplete: true, constraints: content.problem.constraints });
      onValidityChange("stages", false);
      setError(undefined);
    } catch (cause) {
      onValidityChange("stages", true, [authoringIssue(cause, "Steps")]);
      setError((cause as Error).message);
    }
  }
  return (
    <NoticeRegion message={error} label="Check stages">
      <StageAuthoring
        value={stages}
        onChange={change}
        onValidityChange={(id, invalid) => {
          const next = { ...invalidTypes, [id]: invalid };
          setInvalidTypes(next);
          if (invalid || invalidTypes[id]) change(stages, next);
        }}
      />
    </NoticeRegion>
  );
}
