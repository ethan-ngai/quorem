import { FileCode2, Shapes } from "lucide-react";
import { SegmentedControl } from "../../ui/SegmentedControl";

import { OdysseyIcon } from "../../ui/OdysseyIcon";

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
