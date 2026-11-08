import { FileCode2, Shapes } from "lucide-react";
import { SegmentedControl } from "../../ui/SegmentedControl";

import { OdysseyIcon } from "../../ui/OdysseyIcon";

type QuestionType = "classic" | "odyssey";
export function QuestionTypeFilter({
  value,
  onChange,
  exclusive = false,
}: {
  value?: QuestionType;
  exclusive?: boolean;
  onChange: (value: QuestionType | undefined) => void;
}) {
  return (
    <SegmentedControl<QuestionType | "all">
      compact={exclusive}
      iconOnly={!exclusive}
      label={exclusive ? "Question format" : "Question type"}
      value={value ?? (exclusive ? "classic" : "all")}
      onChange={(next) => onChange(next === "all" ? undefined : next)}
      options={[
        ...(exclusive
          ? []
          : [
              {
                value: "all" as const,
                label: "All question types",
                icon: <Shapes size={16} aria-hidden="true" />,
              },
            ]),
        {
          value: "classic",
          label: "Classic",
          icon: <FileCode2 size={16} aria-hidden="true" />,
        },
        { value: "odyssey", label: "Odyssey", icon: <OdysseyIcon /> },
      ]}
    />
  );
}
