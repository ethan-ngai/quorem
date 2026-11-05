/** @file ApproachMetadataFields.tsx @description Explanation and complexity owned once per approach. @module admin */
import type { SolutionApproach } from "@quorem/contracts";
import { Clock3 } from "lucide-react";
import { MarkdownField } from "../../ui/MarkdownField";
import { TextInput } from "../../ui/TextControl";
import { Field } from "./AuthoringFields";
import { inlineStatement } from "../editor/components/StatementMarkdown";
import { complexityMath } from "../editor/complexityMarkup";

export function ApproachMetadataFields({
  approach,
  onChange,
}: {
  approach: SolutionApproach;
  onChange: (patch: Partial<SolutionApproach>) => void;
}) {
  return (
    <>
      <MarkdownField
        label="Explanation"
        value={approach.explanationMarkdown}
        onChange={(explanationMarkdown) => onChange({ explanationMarkdown })}
      />
      <section className="admin-editorial-complexity">
        <h3 className="admin-editorial-heading">
          <Clock3 size={15} /> Complexity
        </h3>
        <div className="admin-field-pair">
          {(
            [
              ["timeComplexity", "Time"],
              ["spaceComplexity", "Auxiliary space"],
            ] as const
          ).map(([field, label]) => (
            <Field label={label} key={field}>
              <TextInput
                mono
                value={approach[field]}
                placeholder="O(n)"
                onChange={(event) => onChange({ [field]: event.target.value })}
              />
              {approach[field].trim() && (
                <span className="admin-complexity-preview">
                  {inlineStatement(complexityMath(approach[field]))}
                </span>
              )}
            </Field>
          ))}
        </div>
        <MarkdownField
          label="Complexity notes"
          compact
          value={approach.complexityNotes}
          onChange={(complexityNotes) => onChange({ complexityNotes })}
        />
      </section>
    </>
  );
}
