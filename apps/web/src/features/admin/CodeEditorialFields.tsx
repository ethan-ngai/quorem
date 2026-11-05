/** @file CodeEditorialFields.tsx @description Language implementations and optional public editorials. @module admin */
import { useRef, useState } from "react";
import type { QuestionContent } from "@quorem/contracts";
import { Clock3, FileText, LockKeyhole, Plus, Trash2 } from "lucide-react";
import { SelectField } from "../../ui/SelectField";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { Tooltip } from "../../ui/Tooltip";
import { SessionDialog } from "../../ui/SessionDialog";
import { MarkdownField } from "../../ui/MarkdownField";
import { TextInput } from "../../ui/TextControl";
import { Field } from "./AuthoringFields";
import { AuthoringCodeField } from "./AuthoringInputs";
import { initialOdysseySource } from "../odyssey/methodStubs";
import { inlineStatement } from "../editor/components/StatementMarkdown";
import { complexityMath } from "../editor/complexityMarkup";
import { revisions, type Language } from "./content";
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
  const problem = content.problem;
  const [codeSection, setCodeSection] = useState<"reference" | "editorial">("editorial");
  const [removal, setRemoval] = useState<"language" | "editorial">();
  const removalTrigger = useRef<HTMLButtonElement>(null);
  const addContent = useRef<HTMLButtonElement>(null);
  function setImplementation(
    index: number,
    patch: Partial<QuestionContent["implementations"][number]>,
  ) {
    onChange({
      ...content,
      implementations: content.implementations.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    });
  }
  function setSolution(language: Language, patch: Partial<QuestionContent["solutions"][number]>) {
    const current = content.solutions.find((item) => item.language === language);
    const next = {
      language,
      source: "",
      explanationMarkdown: "",
      timeComplexity: "",
      spaceComplexity: "",
      complexityNotes: "",
      ...current,
      ...patch,
    };
    onChange({
      ...content,
      solutions: [...content.solutions.filter((item) => item.language !== language), next],
    });
  }

  const index = content.implementations.findIndex((item) => item.language === language);
  const implementation = content.implementations[index];
  const solution = content.solutions.find((item) => item.language === language);
  return (
    <>
      <SessionDialog
        open={!!removal}
        returnFocus={() => {
          const target = removalTrigger.current?.isConnected
            ? removalTrigger.current
            : addContent.current;
          target?.focus({ preventScroll: true });
        }}
        onOpenChange={(open) => {
          if (!open) setRemoval(undefined);
        }}
        title={removal === "language" ? `Remove ${languageLabels[language]}?` : "Remove editorial?"}
        description={
          removal === "language"
            ? "Discards its starter, reference and editorial."
            : "Discards its code, explanation and complexity."
        }
      >
        <footer className="competitive-dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setRemoval(undefined)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button-danger"
            onClick={() => {
              onChange({
                ...content,
                ...(removal === "language"
                  ? {
                      implementations: content.implementations.filter(
                        (item) => item.language !== language,
                      ),
                    }
                  : {}),
                solutions: content.solutions.filter((item) => item.language !== language),
              });
              setRemoval(undefined);
            }}
          >
            Remove
          </button>
        </footer>
      </SessionDialog>
      <div className="admin-code-toolbar">
        <div className="authoring-content-actions">
          <SegmentedControl
            label="Code content"
            value={codeSection}
            onChange={setCodeSection}
            options={[
              {
                value: "reference",
                label: "Judge reference",
                icon: <LockKeyhole size={14} aria-hidden="true" />,
              },
              {
                value: "editorial",
                label: "Public editorial",
                icon: <FileText size={14} aria-hidden="true" />,
              },
            ]}
          />
          {codeSection === "editorial" && solution && (
            <Tooltip content="Remove editorial">
              <button
                type="button"
                className="icon-button destructive-icon"
                aria-label="Remove editorial"
                disabled={disabled}
                onClick={(event) => {
                  removalTrigger.current = event.currentTarget;
                  setRemoval("editorial");
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          )}
        </div>
        <div className="authoring-language-actions">
          <SelectField
            label={problem.sql ? "SQL dialect" : "Question language"}
            value={language}
            disabled={disabled}
            onChange={(value) => {
              const next = languages.find((item) => item === value);
              if (next) onLanguageChange(next);
            }}
            options={languages
              .filter((value) => (problem.sql ? value === "postgresql" : value !== "postgresql"))
              .map((value) => ({
                value,
                label: languageLabels[value],
                leading: <LanguageLogo language={value} />,
              }))}
          />
          {language !== "python" &&
            language !== "postgresql" &&
            content.implementations.some((item) => item.language === language) && (
              <Tooltip content={`Remove ${languageLabels[language]}`}>
                <button
                  type="button"
                  className="icon-button destructive-icon"
                  aria-label={`Remove ${languageLabels[language]}`}
                  disabled={disabled}
                  onClick={(event) => {
                    removalTrigger.current = event.currentTarget;
                    setRemoval("language");
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </Tooltip>
            )}
        </div>
      </div>
      <div key={language}>
        {!implementation && (
          <div className="authoring-content-action">
            <button
              type="button"
              className="button button-secondary"
              ref={addContent}
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...content,
                  implementations: [
                    ...content.implementations,
                    {
                      language,
                      starterSource: problem.odyssey
                        ? initialOdysseySource(problem.odyssey.levels[0]!.methods, language)
                        : "",
                      runtimeRevision: revisions[language][0],
                      harnessRevision: revisions[language][1],
                      referenceSource: "",
                    },
                  ],
                })
              }
            >
              <Plus size={14} aria-hidden="true" /> Add {languageLabels[language]}
            </button>
          </div>
        )}
        {implementation && (
          <>
            <div hidden={codeSection !== "reference"}>
              <AuthoringCodeField
                label={`${solutionLanguageLabel(language)} private judge reference`}
                hideLabel
                language={language}
                source={implementation.referenceSource}
                disabled={disabled}
                onChange={(source) => setImplementation(index, { referenceSource: source })}
              />
            </div>
            <div hidden={codeSection !== "editorial"}>
              {!solution && (
                <div className="authoring-content-action">
                  <button
                    type="button"
                    className="button button-secondary"
                    ref={addContent}
                    disabled={disabled}
                    onClick={() => setSolution(language, {})}
                  >
                    <Plus size={14} aria-hidden="true" /> Add editorial
                  </button>
                </div>
              )}
              {solution && (
                <div>
                  <AuthoringCodeField
                    label={`${solutionLanguageLabel(language)} editorial code`}
                    hideLabel
                    language={language}
                    source={solution.source}
                    disabled={disabled}
                    onChange={(source) => setSolution(language, { source })}
                  />
                  <MarkdownField
                    label="Explanation"
                    value={solution.explanationMarkdown}
                    onChange={(explanationMarkdown) =>
                      setSolution(language, { explanationMarkdown })
                    }
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
                            onChange={(event) =>
                              setSolution(language, { [field]: event.target.value })
                            }
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
                      onChange={(complexityNotes) => setSolution(language, { complexityNotes })}
                    />
                  </section>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
