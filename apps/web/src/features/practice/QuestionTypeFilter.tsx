import { FileCode2, Shapes } from "lucide-react";
import { SegmentedControl } from "../../ui/SegmentedControl";

/** Greek galley: square sail, raised prow and a bank of oars. */
export function OdysseyIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 15h15l3-4v5l-4 4H7l-4-5Zm8-12v12M11 4h6l-1 7h-5M6 17l-2 5m6-5-2 5m6-5-2 5m6-5-2 5" />
    </svg>
  );
}
export type QuestionType = "classic" | "odyssey";
export function QuestionTypeFilter({
  value,
  onChange,
}: {
  value?: QuestionType;
  onChange: (value: QuestionType | undefined) => void;
}) {
  return (
    <SegmentedControl
      iconOnly
      label="Question type"
      value={value ?? "all"}
      onChange={(next) => onChange(next === "all" ? undefined : (next as QuestionType))}
      options={[
        {
          value: "all",
          label: "All question types",
          icon: <Shapes size={16} aria-hidden="true" />,
        },
        { value: "classic", label: "Classic", icon: <FileCode2 size={16} aria-hidden="true" /> },
        { value: "odyssey", label: "Odyssey", icon: <OdysseyIcon /> },
      ]}
    />
  );
}
