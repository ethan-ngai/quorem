import { SegmentedControl } from "../../../ui/SegmentedControl";

export type MatrixFormat = "array" | "matrix";

const formats = [
  { value: "array", label: "Array" },
  { value: "matrix", label: "Matrix" },
] as const;

export function MatrixFormatControl({
  name,
  value,
  onChange,
}: {
  name: string;
  value: MatrixFormat;
  onChange: (format: MatrixFormat) => void;
}) {
  return (
    <SegmentedControl
      label={`${name} format`}
      value={value}
      options={formats}
      onChange={onChange}
      compact
    />
  );
}
