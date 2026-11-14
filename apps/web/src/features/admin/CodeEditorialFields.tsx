import { inputConstraints, withMaxBytes } from "../../ui/input-constraints";
/** @file CodeEditorialFields.tsx @description Approach management and code-only language variants. @module admin */
import { useRef, useState } from "react";
import type { QuestionContent, SolutionApproach } from "@quorem/contracts";
import {
  blankApproach,
  selectApproach,
  approachTitle,
  approachDefaultLanguage,
  withCanonicalApproach,
} from "@quorem/questions";
import { Plus, Trash2, BookmarkCheck, ArrowUpRight, ChevronUp, ChevronDown } from "lucide-react";
import { Field } from "./AuthoringFields";
import { TextInput } from "../../ui/TextControl";
import { SelectField } from "../../ui/SelectField";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { Tooltip } from "../../ui/Tooltip";
import { SessionDialog } from "../../ui/SessionDialog";
import { AuthoringCodeField } from "./AuthoringInputs";
import { ApproachMetadataFields } from "./ApproachMetadataFields";
import { ApproachPicker } from "../editor/components/ApproachPicker";
import type { Language } from "./content";
import { questionLanguages } from "@quorem/questions";
import { languageLabels, solutionLanguageLabel } from "../editor/editorLanguages";

const languages = [...questionLanguages(false), ...questionLanguages(true)];
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
  const [selectedId, setSelectedId] = useState<string>();
  const [removal, setRemoval] = useState<"approach" | "code">();
  const removalTrigger = useRef<HTMLButtonElement>(null),
    addContent = useRef<HTMLButtonElement>(null);
  const approach = selectApproach(content.approaches, selectedId, content.canonicalApproachId);
  const approachIndex = content.approaches.findIndex((item) => item.id === approach?.id);
  const canonical = approach?.id === content.canonicalApproachId;
  const primaryLanguage = content.problem.sql ? "postgresql" : "python";
  const canMakeCanonical = !!approach?.implementations.some(
    (item) => item.language === primaryLanguage && item.source.trim(),
  );
  const variant = approach?.implementations.find((item) => item.language === language);
  function updateApproach(patch: Partial<SolutionApproach>) {
    if (approach)
      onChange({
        ...content,
        approaches: content.approaches.map((item) =>
          item.id === approach.id ? { ...item, ...patch } : item,
        ),
      });
  }
  function moveApproach(offset: -1 | 1) {
    const approaches = [...content.approaches];
    const [item] = approaches.splice(approachIndex, 1);
    if (!item) return;
    approaches.splice(approachIndex + offset, 0, item);
    onChange({ ...content, approaches });
  }
  function addApproach() {
    const next = blankApproach(primaryLanguage, `approach-${crypto.randomUUID()}`);
    if (content.approaches.length) next.title = `Approach ${content.approaches.length + 1}`;
    onChange({
      ...content,
      canonicalApproachId: content.canonicalApproachId || next.id,
      approaches: [...content.approaches, next],
    });
    setSelectedId(next.id);
    onLanguageChange(primaryLanguage);
  }
  function setCode(source: string) {
    if (!approach) return;
    onChange({
      ...content,
      approaches: content.approaches.map((item) =>
        item.id === approach.id
          ? {
              ...item,
              implementations: [
                ...item.implementations.filter((code) => code.language !== language),
                { language, source },
              ],
            }
          : item,
      ),
    });
  }
  return (
    <>
      <SessionDialog
        open={!!removal}
        returnFocus={() =>
          (removalTrigger.current?.isConnected
            ? removalTrigger.current
            : addContent.current
          )?.focus({ preventScroll: true })
        }
        onOpenChange={(open) => {
          if (!open) setRemoval(undefined);
        }}
        title={
          removal === "approach"
            ? `Remove ${approach ? approachTitle(approach, content.canonicalApproachId) : "approach"}?`
            : `Remove ${languageLabels[language]} code?`
        }
        description={
          removal === "approach"
            ? "Discards this approach and all its language variants."
            : "Discards this language variant. Shared explanation and complexity remain."
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
            disabled={disabled}
            onClick={() => {
              if (removal === "approach" && !canonical)
                onChange({
                  ...content,
                  approaches: content.approaches.filter((item) => item.id !== approach?.id),
                });
              else if (
                removal === "code" &&
                approach &&
                approachDefaultLanguage(approach) !== language
              )
                updateApproach({
                  implementations: approach!.implementations.filter(
                    (item) => item.language !== language,
                  ),
                });
              setRemoval(undefined);
            }}
          >
            Remove
          </button>
        </footer>
      </SessionDialog>
      <div className="admin-code-toolbar">
        <div className="authoring-language-actions">
          {approach && (
            <ApproachPicker
              approaches={content.approaches}
              canonicalId={content.canonicalApproachId}
              selectedId={approach.id}
              onChange={setSelectedId}
              disabled={disabled}
            />
          )}
          {approach && content.approaches.length > 1 && (
            <>
              <Tooltip content="Move toward most efficient">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Move toward most efficient"
                  disabled={disabled || approachIndex === 0}
                  onClick={() => moveApproach(-1)}
                >
                  <ChevronUp size={14} aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip content="Move toward least efficient">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Move toward least efficient"
                  disabled={disabled || approachIndex === content.approaches.length - 1}
                  onClick={() => moveApproach(1)}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </Tooltip>
            </>
          )}
          <Tooltip content="Add approach">
            <button
              ref={addContent}
              type="button"
              className="icon-button"
              aria-label="Add approach"
              disabled={disabled || content.approaches.length >= 8}
              onClick={addApproach}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          </Tooltip>
          {approach && (
            <>
              {canonical ? (
                <Tooltip
                  content={`Default approach: its ${languageLabels[primaryLanguage]} code is the canonical reference.`}
                >
                  <span
                    className="authoring-solution-status"
                    role="img"
                    aria-label="Default approach"
                    tabIndex={0}
                  >
                    <BookmarkCheck size={15} aria-hidden="true" />
                  </span>
                </Tooltip>
              ) : (
                <>
                  <Tooltip
                    content={`Requires ${languageLabels[primaryLanguage]} code`}
                    disabled={canMakeCanonical}
                  >
                    <button
                      type="button"
                      className="button button-ghost"
                      disabled={disabled || !canMakeCanonical}
                      onClick={() => onChange(withCanonicalApproach(content, approach.id))}
                    >
                      <BookmarkCheck size={14} aria-hidden="true" /> Make canonical
                    </button>
                  </Tooltip>
                  <Tooltip content="Remove approach">
                    <button
                      type="button"
                      className="icon-button destructive-icon"
                      aria-label="Remove approach"
                      disabled={disabled}
                      onClick={(event) => {
                        removalTrigger.current = event.currentTarget;
                        setRemoval("approach");
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </Tooltip>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {approach && (
        <div key={approach.id}>
          <Field label={canonical ? "Approach name (optional)" : "Approach name"}>
            <TextInput
              constraint={withMaxBytes(inputConstraints.name, 160)}
              value={approach.title ?? ""}
              placeholder={canonical ? "Solution" : "e.g. Hash map"}
              onChange={(event) => updateApproach({ title: event.target.value })}
            />
          </Field>
          <div className="admin-code-toolbar">
            <div className="authoring-language-actions">
              <SelectField
                label={content.problem.sql ? "SQL dialect" : "Code language"}
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
              {variant && language !== approachDefaultLanguage(approach) && (
                <>
                  {!canonical && (
                    <button
                      type="button"
                      className="button button-ghost"
                      disabled={disabled}
                      onClick={() => updateApproach({ defaultLanguage: language })}
                    >
                      Use as default language
                    </button>
                  )}
                  <Tooltip content="Remove language code">
                    <button
                      type="button"
                      className="icon-button destructive-icon"
                      aria-label="Remove language code"
                      disabled={disabled}
                      onClick={(event) => {
                        removalTrigger.current = event.currentTarget;
                        setRemoval("code");
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
          {variant ? (
            <AuthoringCodeField
              key={language}
              label={`${solutionLanguageLabel(language)} approach code`}
              hideLabel
              language={language}
              source={variant.source}
              disabled={disabled}
              onChange={setCode}
            />
          ) : (
            <div className="authoring-content-action">
              <button
                type="button"
                className="button button-secondary"
                disabled={disabled}
                onClick={() => setCode("")}
              >
                <Plus size={14} aria-hidden="true" /> Add {languageLabels[language]} code
              </button>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => onLanguageChange(approachDefaultLanguage(approach))}
              >
                <LanguageLogo language={approachDefaultLanguage(approach)} />
                {languageLabels[approachDefaultLanguage(approach)]} default
                <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            </div>
          )}
          <ApproachMetadataFields approach={approach} onChange={updateApproach} />
        </div>
      )}
    </>
  );
}
