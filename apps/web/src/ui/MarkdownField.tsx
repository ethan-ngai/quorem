import { useId, useState } from "react";
import { Eye, FileText, Pencil } from "lucide-react";
import { SegmentedControl } from "./SegmentedControl";
import { StatementMarkdown } from "../features/editor/components/StatementMarkdown";
import "../features/editor/components/problem-statement.css";
import "./markdown-field.css";

/** Bounded prose editing with the same Markdown renderer as the public question. */
export function MarkdownField({
  label,
  value,
  onChange,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [mode, setMode] = useState<"write" | "preview">("write");
  return (
    <div className="markdown-field" data-compact={compact || undefined}>
      <div className="markdown-field-heading">
        <label htmlFor={id}>
          <FileText size={14} aria-hidden="true" />
          {label}
        </label>
        <SegmentedControl
          label={`${label} view`}
          value={mode}
          onChange={setMode}
          options={[
            { value: "write", label: "Write", icon: <Pencil size={13} aria-hidden="true" /> },
            { value: "preview", label: "Preview", icon: <Eye size={13} aria-hidden="true" /> },
          ]}
        />
      </div>
      <textarea
        id={id}
        hidden={mode !== "write"}
        rows={compact ? 2 : 3}
        value={value}
        placeholder="Write in Markdown…"
        onChange={(event) => onChange(event.target.value)}
      />
      {mode === "preview" && (
        <div
          className="markdown-field-preview problem-copy"
          role="region"
          aria-label={`${label} preview`}
        >
          {value.trim() ? (
            <StatementMarkdown source={value} />
          ) : (
            <span className="markdown-field-empty">Nothing to preview.</span>
          )}
        </div>
      )}
    </div>
  );
}
