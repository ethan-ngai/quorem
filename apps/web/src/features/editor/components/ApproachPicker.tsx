/** @file ApproachPicker.tsx @description Shared approach selection for authoring and workspace guidance. @module editor */
import { approachTitle } from "@quorem/questions";
import { SelectField } from "../../../ui/SelectField";

export function ApproachPicker({
  approaches,
  canonicalId,
  selectedId,
  onChange,
  disabled = false,
}: {
  approaches: readonly { id: string; title?: string }[];
  canonicalId: string;
  selectedId: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <SelectField
      label="Approach"
      value={selectedId}
      onChange={onChange}
      disabled={disabled}
      options={approaches.map((approach) => ({
        value: approach.id,
        label: approachTitle(approach, canonicalId),
      }))}
    />
  );
}
