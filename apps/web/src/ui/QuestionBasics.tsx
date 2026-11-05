import { TextInput } from "./TextControl";
import { MarkdownField } from "./MarkdownField";
/** Shared question copy fields for interview setup and library authoring. */
export function QuestionBasics({
  title,
  statement,
  staged,
  required = false,
  onTitleChange,
  onStatementChange,
}: {
  title: string;
  statement: string;
  staged: boolean;
  required?: boolean;
  onTitleChange: (value: string) => void;
  onStatementChange: (value: string) => void;
}) {
  return (
    <>
      <label className="admin-field">
        <span>Question title</span>
        <TextInput
          required={required}
          maxLength={120}
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </label>
      <MarkdownField
        label={staged ? "Introduction" : "Statement"}
        value={statement}
        onChange={onStatementChange}
      />
    </>
  );
}
