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
        <input
          required={required}
          maxLength={120}
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </label>
      <label className="admin-field">
        <span>{staged ? "Introduction" : "Statement"}</span>
        <textarea
          rows={4}
          value={statement}
          onChange={(event) => onStatementChange(event.target.value)}
        />
      </label>
    </>
  );
}
