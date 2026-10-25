/** Shared question copy and starter fields for interview setup and library authoring. */
export function QuestionBasics({
  title,
  statement,
  starter,
  staged,
  required = false,
  onTitleChange,
  onStatementChange,
  onStarterChange,
}: {
  title: string;
  statement: string;
  starter?: string;
  staged: boolean;
  required?: boolean;
  onTitleChange: (value: string) => void;
  onStatementChange: (value: string) => void;
  onStarterChange: (value: string) => void;
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
      {starter !== undefined && (
        <label className="admin-field">
          <span>{staged ? "Initial starter code" : "Starter code"}</span>
          <textarea
            className="admin-code"
            rows={8}
            value={starter}
            onChange={(event) => onStarterChange(event.target.value)}
            spellCheck={false}
          />
        </label>
      )}
    </>
  );
}
