import { useId } from "react";
import { FileText } from "lucide-react";
import { TextArea } from "./TextControl";

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
  return (
    <div className="admin-field">
      <label htmlFor={id} className="admin-icon-label">
        <FileText size={14} aria-hidden="true" />
        {label}
      </label>
      <TextArea
        id={id}
        rows={compact ? 2 : 3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
