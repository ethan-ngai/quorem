/** @file SolutionToolbar.tsx @description Shared language and intelligence controls. @module editor */
import { SelectField } from "../../../ui/SelectField";
import { LanguageLogo } from "../../../ui/LanguageLogo";
import { languageLabels, type EditorLanguage } from "../editorLanguages";
import { Tooltip } from "../../../ui/Tooltip";

export function SolutionToolbar({
  language,
  languages,
  disabled,
  onChange,
  intelligence,
}: {
  language: EditorLanguage;
  languages: readonly { language: string }[];
  disabled?: boolean;
  onChange?: (language: EditorLanguage) => void;
  intelligence?: { status: string; hint: string };
}) {
  return (
    <div className="code-toolbar">
      <SelectField
        className="select-field--compact"
        label="Solution language"
        value={language}
        disabled={disabled || !onChange}
        onChange={(value) => onChange?.(value as EditorLanguage)}
        options={languages.map((item) => ({
          value: item.language,
          label: languageLabels[item.language as EditorLanguage],
          leading: <LanguageLogo language={item.language as EditorLanguage} />,
        }))}
      />
      <div className="code-options">
        {intelligence && (
          <Tooltip content={intelligence.hint}>
            <span
              role="img"
              tabIndex={0}
              className="intelligence-status"
              data-status={intelligence.status}
              aria-label={intelligence.hint}
            >
              <span className="intelligence-dot" aria-hidden="true" />
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
