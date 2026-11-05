/** @file CodeEditorialFields.tsx @description One canonical solution and optional language editorials. @module admin */
import { useRef, useState } from "react";
import type { QuestionContent } from "@quorem/contracts";
import { blankSolution } from "@quorem/questions";
import { Clock3, Plus, Trash2, BookmarkCheck, ArrowUpRight, Code2 } from "lucide-react";
import { SelectField } from "../../ui/SelectField";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { Tooltip } from "../../ui/Tooltip";
import { SessionDialog } from "../../ui/SessionDialog";
import { MarkdownField } from "../../ui/MarkdownField";
import { TextInput } from "../../ui/TextControl";
import { Field } from "./AuthoringFields";
import { AuthoringCodeField } from "./AuthoringInputs";
import { inlineStatement } from "../editor/components/StatementMarkdown";
import { complexityMath } from "../editor/complexityMarkup";
import { revisions, languageImplementation, type Language } from "./content";
import { languageLabels, solutionLanguageLabel } from "../editor/editorLanguages";

const languages = Object.keys(revisions) as Language[];

export function CodeEditorialFields({
  content,
  language,
  onLanguageChange,
  disabled,
  onChange,
}: {
  content: QuestionContent;
  language: Language;
  onLanguageChange: (language: Language) => void;
  disabled: boolean;
  onChange: (content: QuestionContent) => void;
}) {
  const [removal, setRemoval] = useState(false);
  const removalTrigger = useRef<HTMLButtonElement>(null);
  const addContent = useRef<HTMLButtonElement>(null);
  const implementation = content.implementations.find((item) => item.language === language);
  const canonical = language === content.canonicalSolution.language;
  const solution = canonical
    ? content.canonicalSolution
    : content.solutions.find((item) => item.language === language);
  function setSolution(patch: Partial<QuestionContent["canonicalSolution"]>) {
    const next = { ...blankSolution(language), ...solution, ...patch };
    onChange(
      canonical
        ? { ...content, canonicalSolution: next }
        : {
            ...content,
            implementations: content.implementations.some((item) => item.language === language)
              ? content.implementations
              : [...content.implementations, languageImplementation(language)],
            solutions: [...content.solutions.filter((item) => item.language !== language), next],
          },
    );
  }
  return (
    <>
      <SessionDialog
        open={removal}
        returnFocus={() =>
          (removalTrigger.current?.isConnected
            ? removalTrigger.current
            : addContent.current
          )?.focus({ preventScroll: true })
        }
        onOpenChange={setRemoval}
        title={`Remove ${languageLabels[language]} editorial?`}
        description="Discards its code, explanation and complexity."
      >
        <footer className="competitive-dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setRemoval(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button-danger"
            disabled={disabled}
            onClick={() => {
              onChange({
                ...content,
                solutions: content.solutions.filter((item) => item.language !== language),
              });
              setRemoval(false);
            }}
          >
            Remove
          </button>
        </footer>
      </SessionDialog>
      <div className="admin-code-toolbar">
        <div className="authoring-language-actions">
          <SelectField
            label={content.problem.sql ? "SQL dialect" : "Editorial language"}
            value={language}
            disabled={disabled}
            onChange={(value) => {
              const next = languages.find((item) => item === value);
              if (next) onLanguageChange(next);
            }}
            options={languages
              .filter((value) =>
                content.problem.sql ? value === "postgresql" : value !== "postgresql",
              )
              .map((value) => ({
                value,
                label: languageLabels[value],
                leading: <LanguageLogo language={value} />,
              }))}
          />
          {canonical && (
            <Tooltip content="Default solution: used for judging and as the fallback editorial.">
              <span
                className="authoring-solution-status"
                role="img"
                aria-label="Default solution"
                tabIndex={0}
              >
                <BookmarkCheck size={15} aria-hidden="true" />
              </span>
            </Tooltip>
          )}
          {!implementation && (
            <button
              type="button"
              className="button button-ghost"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...content,
                  implementations: [...content.implementations, languageImplementation(language)],
                })
              }
            >
              <Code2 size={14} aria-hidden="true" /> Allow submissions
            </button>
          )}
          {!canonical && solution && (
            <Tooltip content="Remove editorial">
              <button
                ref={removalTrigger}
                type="button"
                className="icon-button destructive-icon"
                aria-label="Remove editorial"
                disabled={disabled}
                onClick={() => setRemoval(true)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      <div key={language}>
        {!solution ? (
          <div className="authoring-content-action">
            <button
              type="button"
              className="button button-secondary"
              ref={addContent}
              disabled={disabled}
              onClick={() => setSolution({})}
            >
              <Plus size={14} aria-hidden="true" /> Add {languageLabels[language]} editorial
            </button>
            <Tooltip content="View the default solution">
              <button
                type="button"
                className="button button-ghost"
                onClick={() => onLanguageChange(content.canonicalSolution.language)}
              >
                <LanguageLogo language={content.canonicalSolution.language} />
                {languageLabels[content.canonicalSolution.language]} default
                <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        ) : (
          <div>
            <AuthoringCodeField
              label={`${solutionLanguageLabel(language)} ${canonical ? "canonical solution" : "editorial code"}`}
              hideLabel
              language={language}
              source={solution.source}
              disabled={disabled}
              onChange={(source) => setSolution({ source })}
            />
            <MarkdownField
              label="Explanation"
              value={solution.explanationMarkdown}
              onChange={(explanationMarkdown) => setSolution({ explanationMarkdown })}
            />
            <section className="admin-editorial-complexity">
              <h3 className="admin-editorial-heading">
                <Clock3 size={15} /> Complexity
              </h3>
              <div className="admin-field-pair">
                {(
                  [
                    ["timeComplexity", "Time"],
                    ["spaceComplexity", "Auxiliary space"],
                  ] as const
                ).map(([field, label]) => (
                  <Field label={label} key={field}>
                    <TextInput
                      mono
                      value={solution[field]}
                      placeholder="O(n)"
                      onChange={(event) => setSolution({ [field]: event.target.value })}
                    />
                    {solution[field].trim() && (
                      <span className="admin-complexity-preview">
                        {inlineStatement(complexityMath(solution[field]))}
                      </span>
                    )}
                  </Field>
                ))}
              </div>
              <MarkdownField
                label="Complexity notes"
                compact
                value={solution.complexityNotes}
                onChange={(complexityNotes) => setSolution({ complexityNotes })}
              />
            </section>
          </div>
        )}
      </div>
    </>
  );
}
