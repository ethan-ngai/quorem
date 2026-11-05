/** @file SolutionDisplay.tsx @description Shared approach and language presentation for published solutions. @module editor */
import { useState } from "react";
import type { SolutionApproach } from "@quorem/contracts";
import { approachCode, selectApproach } from "@quorem/questions";
import { SelectField } from "../../../ui/SelectField";
import { LanguageLogo } from "../../../ui/LanguageLogo";
import { ApproachPicker } from "./ApproachPicker";
import { StatementMarkdown } from "./StatementMarkdown";
import { EditorialCode } from "./EditorialCode";
import { ComplexityDetails } from "./ComplexityDetails";
import { solutionLanguageLabel } from "../editorLanguages";
import type { EditorTheme } from "../PythonEditor";
import type { EditorScheme } from "../editorSchemes";
import "./editorial.css";

export function SolutionDisplay({
  approaches,
  canonicalApproachId,
  selectedId,
  onApproachChange,
  preferredLanguage,
  theme,
  colorScheme,
}: {
  approaches: readonly SolutionApproach[];
  canonicalApproachId: string;
  selectedId?: string;
  onApproachChange?: (id: string) => void;
  preferredLanguage?: string;
  theme: EditorTheme;
  colorScheme: EditorScheme;
}) {
  const [localId, setLocalId] = useState<string>();
  const [languages, setLanguages] = useState<Record<string, string>>({});
  const approach = selectApproach(approaches, selectedId ?? localId, canonicalApproachId);
  if (!approach) return null;
  const variants = approach.implementations.filter((item) => item.source.trim());
  const code =
    approachCode(
      { ...approach, implementations: variants },
      languages[approach.id] ?? preferredLanguage ?? approach.defaultLanguage,
    ) ?? variants[0];
  return (
    <div className="solution-display">
      <div className="solution-toolbar">
        {approaches.length > 1 && (
          <ApproachPicker
            approaches={approaches}
            canonicalId={canonicalApproachId}
            selectedId={approach.id}
            onChange={onApproachChange ?? setLocalId}
          />
        )}
        {code &&
          (variants.length > 1 ? (
            <SelectField
              label="Solution language"
              value={code.language}
              options={variants.map((item) => ({
                value: item.language,
                label: solutionLanguageLabel(item.language),
                leading: <LanguageLogo language={item.language} />,
              }))}
              onChange={(language) =>
                setLanguages((previous) => ({ ...previous, [approach.id]: language }))
              }
            />
          ) : (
            <span className="solution-language">
              <LanguageLogo language={code.language} />
              {solutionLanguageLabel(code.language)}
            </span>
          ))}
      </div>
      {approach.explanationMarkdown && (
        <div className="solution-explanation">
          <StatementMarkdown source={approach.explanationMarkdown} />
        </div>
      )}
      {code && (
        <EditorialCode
          source={code.source}
          language={code.language}
          theme={theme}
          colorScheme={colorScheme}
        />
      )}
      {(approach.timeComplexity || approach.spaceComplexity || approach.complexityNotes) && (
        <ComplexityDetails value={approach} />
      )}
    </div>
  );
}
